import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [totalTokensUsed, setTotalTokensUsed] = useState(0)

  // ISBN scraping state
  const [isbn, setIsbn] = useState('')
  const [scrapeResult, setScrapeResult] = useState('')
  const [scrapeLoading, setScrapeLoading] = useState(false)
  const [autoSubmit, setAutoSubmit] = useState(true)

  // Timer state
  const [processStartTime, setProcessStartTime] = useState(null)
  const [processDuration, setProcessDuration] = useState(null)
  const [processType, setProcessType] = useState('')

  // Batch processing state
  const [batchMode, setBatchMode] = useState(false)
  const [batchResults, setBatchResults] = useState({})
  const [batchSummary, setBatchSummary] = useState(null)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
  const [isbnArray, setIsbnArray] = useState([])
  const [batchProcessing, setBatchProcessing] = useState(false)

  // CSV save state
  const [csvSaving, setCsvSaving] = useState(false)
  const [csvSaveResult, setCsvSaveResult] = useState(null)

  // CSV upload state
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvUploadResult, setCsvUploadResult] = useState(null)
  const [dragActive, setDragActive] = useState(false)

  // Chunked processing state
  const [chunkJobId, setChunkJobId] = useState(null)
  const [chunkProgress, setChunkProgress] = useState(null)
  const [chunkProcessing, setChunkProcessing] = useState(false)
  const [eventSource, setEventSource] = useState(null)

  // Toggle state for scrape result
  const [showScrapeResult, setShowScrapeResult] = useState(false)

  // Toggle state for AI response
  const [showAiResponse, setShowAiResponse] = useState(true)

  // Toggle state for documentation
  const [showDocumentation, setShowDocumentation] = useState(false)

  // Function to parse multiple ISBNs from input text
  const parseISBNs = (inputText) => {
    if (!inputText.trim()) return [];

    // Split by common separators: comma, semicolon, newline, space
    const isbns = inputText
      .split(/[,;\n\s]+/)
      .map(isbn => isbn.trim())
      .filter(isbn => isbn.length > 0)
      .filter(isbn => /^[0-9\-Xx]+$/.test(isbn)); // Basic ISBN format validation

    return [...new Set(isbns)]; // Remove duplicates
  };

  // Function to parse HTML and extract readable text
  const parseHtmlContent = (htmlString) => {
    try {
      // Create a temporary DOM element to parse HTML
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlString, 'text/html')

      // Remove script and style elements
      const scripts = doc.querySelectorAll('script, style')
      scripts.forEach(el => el.remove())

      // Get text content and clean it up
      let textContent = doc.body.textContent || doc.body.innerText || ''

      // Clean up the text: remove extra whitespace, normalize line breaks
      textContent = textContent
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .replace(/\n\s*\n/g, '\n')  // Remove empty lines
        .trim()

      return textContent
    } catch (error) {
      console.error('Error parsing HTML:', error)
      return 'Error parsing HTML content'
    }
  }

  const resetTokenCounter = () => {
    setTotalTokensUsed(0)
    setTokenUsage(null)
  }

  const handleSaveToCsv = async (currentIsbn, aiResponse) => {
    if (!currentIsbn || !aiResponse) return

    setCsvSaving(true)
    setCsvSaveResult(null)

    try {
      const res = await fetch('http://localhost:3001/api/save-to-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isbn: currentIsbn,
          aiResponse: aiResponse
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setCsvSaveResult({
          success: true,
          message: data.message,
          duplicate: data.duplicate
        })
      } else {
        setCsvSaveResult({
          success: false,
          message: `Error: ${data.error}`
        })
      }
    } catch (error) {
      setCsvSaveResult({
        success: false,
        message: `Error: ${error.message}`
      })
    } finally {
      setCsvSaving(false)
    }
  }

  const handleDownloadCsv = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/download-csv')

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'ai_responses.csv'
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        const errorData = await res.json()
        alert(`Download failed: ${errorData.error}`)
      }
    } catch (error) {
      alert(`Download failed: ${error.message}`)
    }
  }

  // CSV upload handlers
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setCsvFile(file)
        setCsvUploadResult(null)
      } else {
        alert('Please upload a CSV file')
      }
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setCsvFile(file)
        setCsvUploadResult(null)
      } else {
        alert('Please upload a CSV file')
      }
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile) return

    setCsvUploading(true)
    setCsvUploadResult(null)
    setBatchResults({})
    setBatchSummary(null)
    setResponse('')
    setScrapeResult('')

    // Start timer
    const startTime = Date.now()
    setProcessStartTime(startTime)
    setProcessDuration(null)
    setProcessType(`CSV Upload Processing (${csvFile.name})`)

    try {
      const formData = new FormData()
      formData.append('csvFile', csvFile)

      const res = await fetch('http://localhost:3001/api/upload-csv-workflow', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()

      if (res.ok) {
        // Set results in the same format as batch processing
        setBatchResults(data.results)
        setBatchSummary(data.summary)
        setCsvUploadResult({
          success: true,
          message: `Successfully processed ${data.summary.total} ISBNs from CSV`,
          csvFileInfo: data.csvFileInfo
        })
        setScrapeResult(`CSV Upload completed: ${data.summary.aiSuccessful}/${data.summary.total} successful`)
      } else {
        setCsvUploadResult({
          success: false,
          message: `Upload failed: ${data.error}`,
          details: data.details
        })
        setScrapeResult(`CSV Upload Error: ${data.error}`)
      }
    } catch (error) {
      setCsvUploadResult({
        success: false,
        message: `Upload failed: ${error.message}`
      })
      setScrapeResult(`CSV Upload Error: ${error.message}`)
    } finally {
      setCsvUploading(false)
      // Calculate and set process duration
      const endTime = Date.now()
      const duration = endTime - startTime
      setProcessDuration(duration)
    }
  }

  const clearCsvFile = () => {
    setCsvFile(null)
    setCsvUploadResult(null)
  }

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [eventSource])

  // Chunked CSV upload handler
  const handleChunkedCsvUpload = async () => {
    if (!csvFile) return

    setChunkProcessing(true)
    setChunkProgress(null)
    setChunkJobId(null)
    setCsvUploadResult(null)
    setBatchResults({})
    setBatchSummary(null)

    // Start timer
    const startTime = Date.now()
    setProcessStartTime(startTime)
    setProcessDuration(null)
    setProcessType(`Chunked CSV Processing (${csvFile.name})`)

    try {
      const formData = new FormData()
      formData.append('csvFile', csvFile)

      const res = await fetch('http://localhost:3001/api/chunked-csv-workflow', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()

      if (res.ok) {
        setChunkJobId(data.jobId)

        // Set up Server-Sent Events for progress tracking
        const es = new EventSource(`http://localhost:3001/api/job-progress/${data.jobId}`)
        setEventSource(es)

        es.onmessage = (event) => {
          const progressData = JSON.parse(event.data)
          setChunkProgress(progressData)

          if (progressData.status === 'completed') {
            // Job completed, fetch final results
            fetch(`http://localhost:3001/api/job-status/${data.jobId}`)
              .then(res => res.json())
              .then(finalData => {
                setBatchResults(finalData.results || {})
                setBatchSummary(finalData.summary || {})
                setCsvUploadResult({
                  success: true,
                  message: `Successfully processed ${finalData.summary?.total || 0} ISBNs using chunked processing`,
                  csvFileInfo: data.csvFileInfo
                })

                // Calculate duration
                const endTime = Date.now()
                const duration = endTime - startTime
                setProcessDuration(duration)

                setChunkProcessing(false)
                es.close()
                setEventSource(null)
              })
              .catch(error => {
                console.error('Error fetching final results:', error)
                setChunkProcessing(false)
                es.close()
                setEventSource(null)
              })
          } else if (progressData.status === 'failed') {
            setCsvUploadResult({
              success: false,
              message: `Chunked processing failed: ${progressData.error}`,
              details: progressData.details
            })
            setChunkProcessing(false)
            es.close()
            setEventSource(null)
          }
        }

        es.onerror = (error) => {
          console.error('EventSource error:', error)
          setCsvUploadResult({
            success: false,
            message: 'Failed to receive progress updates'
          })
          setChunkProcessing(false)
          es.close()
          setEventSource(null)
        }

      } else {
        setCsvUploadResult({
          success: false,
          message: `Chunked upload failed: ${data.error}`,
          details: data.details
        })
        setChunkProcessing(false)
      }
    } catch (error) {
      setCsvUploadResult({
        success: false,
        message: `Chunked upload failed: ${error.message}`
      })
      setChunkProcessing(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setResponse('')
    setTokenUsage(null)

    const enhancedPrompt = prompt + "\n\ngive me json response metadata of the books like: title, author, publisher, pages, description, edition_year, isbn, libraccio_image_src,"
    try {
      const res = await fetch('http://localhost:3001/api/openrouter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: enhancedPrompt }),
      })

      const data = await res.json()

      if (res.ok) {
        setResponse(data.response)
        setTokenUsage(data.tokenUsage)
        setTotalTokensUsed(prev => prev + (data.tokenUsage?.totalTokens || 0))
      } else {
        setResponse(`Error: ${data.error}`)
        setTokenUsage(null)
      }
    } catch (error) {
      setResponse(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleScrapeSubmit = async (e) => {
    e.preventDefault()
    if (!isbn.trim()) return

    // Clear previous results
    setScrapeResult('')
    setResponse('')
    setTokenUsage(null)
    setBatchResults({})
    setBatchSummary(null)

    // Start timer
    const startTime = Date.now()
    setProcessStartTime(startTime)
    setProcessDuration(null)

    if (batchMode && isbnArray.length > 1) {
      // Handle batch processing
      setProcessType(`Batch processing (${isbnArray.length} ISBNs)`)
      setBatchProcessing(true)
      setBatchProgress({ current: 0, total: isbnArray.length })

      try {
        const res = await fetch('http://localhost:3001/api/scrape-libraccio-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isbns: isbnArray }),
        })

        const data = await res.json()

        if (res.ok) {
          setBatchResults(data.results)
          setBatchSummary(data.summary)
          setScrapeResult(`Batch completed: ${data.summary.successful}/${data.summary.total} successful`)
        } else {
          setScrapeResult(`Batch Error: ${data.error}`)
        }
      } catch (error) {
        setScrapeResult(`Batch Error: ${error.message}`)
      } finally {
        setBatchProcessing(false)
      }
    } else {
      // Handle single ISBN processing
      setProcessType(autoSubmit ? 'Full workflow (Scraping + AI Processing)' : 'Scraping only')
      setScrapeLoading(true)

    try {
      const res = await fetch('http://localhost:3001/api/scrape-libraccio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isbn: isbnArray[0] || isbn.trim() }),
      })

      const data = await res.json()

      if (res.ok) {
        setScrapeResult(JSON.stringify(data, null, 2))

        // If scraping was successful and we found content
        if (data.found && data.html) {
          // Parse the HTML to extract readable text
          const parsedText = parseHtmlContent(data.html)

          // Create a structured prompt for the AI
          const structuredPrompt = `Please analyze this book information from Libraccio and extract the metadata:

${parsedText}

Please provide a JSON response with the following book metadata:
- title
- author
- publisher
- pages
- edition_year
- isbn
- description
`

          // Auto-populate the prompt field
          setPrompt(structuredPrompt)

          // Auto-submit if enabled
          if (autoSubmit) {
            setLoading(true)
            try {
              const aiRes = await fetch('http://localhost:3001/api/openrouter', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt: structuredPrompt }),
              })

              const aiData = await aiRes.json()

              if (aiRes.ok) {
                setResponse(aiData.response)
                setTokenUsage(aiData.tokenUsage)
                setTotalTokensUsed(prev => prev + (aiData.tokenUsage?.totalTokens || 0))

                // Automatically save to CSV after successful AI response
                const currentIsbn = isbnArray[0] || isbn.trim()
                const responseToSave = typeof aiData.response === 'object' ? JSON.stringify(aiData.response) : aiData.response
                handleSaveToCsv(currentIsbn, responseToSave)
              } else {
                setResponse(`AI Error: ${aiData.error}`)
              }
            } catch (aiError) {
              setResponse(`AI Error: ${aiError.message}`)
            } finally {
              setLoading(false)
            }
          }
        }
      } else {
        setScrapeResult(`Error: ${data.error}\nDetails: ${data.details || 'No additional details'}`)
      }
    } catch (error) {
      setScrapeResult(`Error: ${error.message}`)
    } finally {
      setScrapeLoading(false)
    }
    }

    // Calculate and set process duration
    const endTime = Date.now()
    const duration = endTime - startTime
    setProcessDuration(duration)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Assistant & Libraccio Scraper</h1>
        <p>Generate AI content or scrape book information from Libraccio using ISBN</p>
      </header>

      <main className="main-content">
        <form onSubmit={handleSubmit} className="prompt-form" style={{ display: 'none' }}>
          <div className="input-group">
            <label htmlFor="prompt">Your Prompt:</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              rows={6}
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading || !prompt.trim()}>
            {loading ? 'Generating...' : 'Generate Response'}
          </button>
        </form>

        <div className="divider" style={{ display: 'none' }}>
          <hr />
          <span>OR</span>
          <hr />
        </div>

        <form onSubmit={handleScrapeSubmit} className="scrape-form">
          <div className="input-group">
            <label htmlFor="isbn">
              ISBN Search:
              {isbnArray.length > 0 && (
                <span className="isbn-counter">
                  {isbnArray.length} ISBN{isbnArray.length > 1 ? 's' : ''} detected
                </span>
              )}
            </label>
            <textarea
              id="isbn"
              value={isbn}
              onChange={(e) => {
                const value = e.target.value;
                setIsbn(value);
                const parsedISBNs = parseISBNs(value);
                setIsbnArray(parsedISBNs);
                setBatchMode(parsedISBNs.length > 1);
              }}
              placeholder="Enter ISBN(s):
• Single: 9781234567890
• Multiple: 9781234567890, 9780987654321
• Line separated or comma separated"
              rows={4}
              disabled={scrapeLoading || batchProcessing}
            />
          </div>

          <div className="input-group" style={{ display: 'none' }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => setAutoSubmit(e.target.checked)}
                disabled={scrapeLoading}
              />
              Auto-submit to AI after scraping
            </label>
          </div>

          <button type="submit" disabled={scrapeLoading || batchProcessing || !isbn.trim()}>
            {batchProcessing ?
              `Processing Batch (${batchProgress.current}/${batchProgress.total})...` :
              scrapeLoading ?
                (loading ? 'Scraping & Processing...' : 'Scraping...') :
                batchMode ?
                  `Search ${isbnArray.length} ISBNs` :
                  'Search Libraccio'
            }
          </button>
        </form>

        <div className="divider">
          <hr />
          <span>OR</span>
          <hr />
        </div>

        {/* CSV Upload Section */}
        <div className="csv-upload-section">
          <h3>📁 Upload CSV File with ISBNs</h3>
          <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px 0' }}>
            Upload a CSV file containing ISBNs to process them all automatically through the full workflow
          </p>

          <div
            className={`csv-drop-zone ${dragActive ? 'drag-active' : ''} ${csvFile ? 'has-file' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragActive ? '#007bff' : csvFile ? '#28a745' : '#ccc'}`,
              borderRadius: '8px',
              padding: '24px',
              textAlign: 'center',
              backgroundColor: dragActive ? '#f8f9fa' : csvFile ? '#f8fff9' : '#fafafa',
              marginBottom: '16px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => document.getElementById('csvFileInput').click()}
          >
            {csvFile ? (
              <div>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📄</div>
                <div style={{ fontWeight: 'bold', color: '#28a745' }}>{csvFile.name}</div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  {(csvFile.size / 1024).toFixed(1)} KB
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    clearCsvFile()
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                  {dragActive ? 'Drop CSV file here' : 'Click to upload or drag & drop CSV file'}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  Supports CSV files with ISBN column (max 1MB, up to 50 ISBNs)
                </div>
              </div>
            )}
          </div>

          <input
            id="csvFileInput"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {csvFile && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button
                  onClick={handleCsvUpload}
                  disabled={csvUploading || chunkProcessing}
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    backgroundColor: (csvUploading || chunkProcessing) ? '#6c757d' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (csvUploading || chunkProcessing) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {csvUploading ? 'Processing...' : `🚀 Process CSV (≤50 ISBNs)`}
                </button>
                <button
                  onClick={handleChunkedCsvUpload}
                  disabled={csvUploading || chunkProcessing}
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    backgroundColor: (csvUploading || chunkProcessing) ? '#6c757d' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (csvUploading || chunkProcessing) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {chunkProcessing ? 'Processing...' : `⚡ Chunked Process (Unlimited)`}
                </button>
              </div>
              <p style={{ fontSize: '12px', color: '#666', margin: '0', lineHeight: '1.4' }}>
                <strong>Regular:</strong> Up to 50 ISBNs, all processed at once<br/>
                <strong>Chunked:</strong> Unlimited ISBNs, processed in batches of 50 with progress tracking
              </p>
            </div>
          )}

          {/* Chunked Processing Progress UI */}
          {chunkProgress && (
            <div style={{
              padding: '16px',
              border: '1px solid #007bff',
              borderRadius: '4px',
              backgroundColor: '#f8f9fa',
              marginBottom: '16px'
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#007bff' }}>
                📊 Processing Progress - Job {chunkJobId?.substring(0, 8)}...
              </h4>

              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    Chunks: {chunkProgress.chunksCompleted || 0} / {chunkProgress.totalChunks || 0}
                  </span>
                  <span style={{ fontSize: '14px', color: '#666' }}>
                    {Math.round(chunkProgress.progressPercentage || 0)}%
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#e9ecef',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${chunkProgress.progressPercentage || 0}%`,
                    height: '100%',
                    backgroundColor: '#007bff',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666' }}>
                <span>📚 Total ISBNs: {chunkProgress.totalItems || 0}</span>
                <span>✅ Processed: {chunkProgress.processedItems || 0}</span>
                <span>⏱️ Status: {chunkProgress.status}</span>
                {chunkProgress.eta && (
                  <span>🕒 ETA: {Math.round(chunkProgress.eta / 1000)}s</span>
                )}
              </div>

              {chunkProgress.currentChunk && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  backgroundColor: '#e3f2fd',
                  borderRadius: '3px',
                  fontSize: '12px'
                }}>
                  Current chunk: {chunkProgress.currentChunk.start + 1}-{chunkProgress.currentChunk.end}
                  (ISBNs: {chunkProgress.currentChunk.isbns?.slice(0, 3).join(', ')}...)
                </div>
              )}
            </div>
          )}

          {csvUploadResult && (
            <div className={`csv-upload-result ${csvUploadResult.success ? 'success' : 'error'}`} style={{
              padding: '12px',
              borderRadius: '4px',
              backgroundColor: csvUploadResult.success ? '#d4edda' : '#f8d7da',
              border: `1px solid ${csvUploadResult.success ? '#c3e6cb' : '#f5c6cb'}`,
              color: csvUploadResult.success ? '#155724' : '#721c24',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>
                  {csvUploadResult.success ? '✅' : '❌'}
                </span>
                <span style={{ fontWeight: 'bold' }}>{csvUploadResult.message}</span>
              </div>
              {csvUploadResult.csvFileInfo && (
                <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.8 }}>
                  Detected columns: {csvUploadResult.csvFileInfo.detectedColumns.join(', ')}
                  {csvUploadResult.csvFileInfo.isbnColumnDetected && (
                    <br />
                  )}
                  {csvUploadResult.csvFileInfo.isbnColumnDetected &&
                    `ISBN column: ${csvUploadResult.csvFileInfo.isbnColumnDetected}`
                  }
                </div>
              )}
              {csvUploadResult.details && (
                <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.8 }}>
                  {csvUploadResult.details}
                </div>
              )}
            </div>
          )}
        </div>

        {(tokenUsage || processDuration !== null) && (
          <div style={{
            padding: '8px 12px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            margin: '12px 0',
            fontSize: '13px',
            color: '#666',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center'
          }}>
            {tokenUsage && <span>Input: {tokenUsage.promptTokens}</span>}
            {tokenUsage && <span>Output: {tokenUsage.responseTokens}</span>}
            {tokenUsage && <span>All tokens: {tokenUsage.totalTokens}</span>}
            {processDuration !== null && <span>Time: {(processDuration / 1000).toFixed(1)}s</span>}
            {tokenUsage && (
              <button
                onClick={resetTokenCounter}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  backgroundColor: '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  marginLeft: 'auto'
                }}
              >
                Reset
              </button>
            )}
          </div>
        )}

        {response && (
          <div className="response-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <h3 style={{ margin: 0 }}>AI Response:</h3>
              <button
                onClick={() => setShowAiResponse(!showAiResponse)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: showAiResponse ? '#dc3545' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showAiResponse ? 'Hide' : 'Show'}
              </button>
            </div>
            {showAiResponse && (
              <>
                <div className="response-content">
                  <pre>{typeof response === 'object' ? JSON.stringify(response, null, 2) : response}</pre>
                </div>
                <div className="response-actions" style={{ display: 'none' }}>
                  <button
                    onClick={() => handleSaveToCsv(isbnArray[0] || isbn.trim(), typeof response === 'object' ? JSON.stringify(response) : response)}
                    disabled={csvSaving || !response || (!isbnArray[0] && !isbn.trim())}
                    className="save-csv-btn"
                  >
                    {csvSaving ? 'Saving to CSV...' : 'Save to CSV'}
                  </button>
                </div>
                {csvSaveResult && (
                  <div className={`csv-save-result ${csvSaveResult.success ? 'success' : 'error'}`}>
                    <span className="result-icon">
                      {csvSaveResult.success ?
                        (csvSaveResult.duplicate ? '⚠️' : '✅') : '❌'
                      }
                    </span>
                    <span className="result-message">{csvSaveResult.message}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {scrapeResult && (
          <div className="response-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <h3 style={{ margin: 0 }}>Libraccio Scrape Result:</h3>
              <button
                onClick={() => setShowScrapeResult(!showScrapeResult)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: showScrapeResult ? '#dc3545' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showScrapeResult ? 'Hide' : 'Show'}
              </button>
            </div>
            {showScrapeResult && (
              <div className="response-content">
                <pre>{scrapeResult}</pre>
              </div>
            )}
          </div>
        )}

        {batchSummary && Object.keys(batchResults).length > 0 && (
          <div className="batch-results-section">
            <h3>Batch Processing Results</h3>

            <div className="batch-summary">
              <div className="summary-stats">
                <div className="summary-stat success">
                  <span className="stat-label">Successful:</span>
                  <span className="stat-value">{batchSummary.successful || batchSummary.scrapeSuccessful || 0}</span>
                </div>
                <div className="summary-stat failed">
                  <span className="stat-label">Failed:</span>
                  <span className="stat-value">{batchSummary.failed || 0}</span>
                </div>
                <div className="summary-stat total">
                  <span className="stat-label">Total:</span>
                  <span className="stat-value">{batchSummary.total || 0}</span>
                </div>
                {batchSummary.aiSuccessful !== undefined && (
                  <div className="summary-stat ai-success">
                    <span className="stat-label">AI Processed:</span>
                    <span className="stat-value">{batchSummary.aiSuccessful}</span>
                  </div>
                )}
                {batchSummary.csvSuccessful !== undefined && (
                  <div className="summary-stat csv-success">
                    <span className="stat-label">CSV Saved:</span>
                    <span className="stat-value">{batchSummary.csvSuccessful}</span>
                  </div>
                )}
                <div className="summary-stat duration">
                  <span className="stat-label">Total Duration:</span>
                  <span className="stat-value">{((batchSummary.totalDuration || 0) / 1000).toFixed(2)}s</span>
                </div>
                <div className="summary-stat average">
                  <span className="stat-label">Avg per ISBN:</span>
                  <span className="stat-value">{((batchSummary.averageDuration || 0) / 1000).toFixed(2)}s</span>
                </div>
              </div>

              <div className="batch-actions">
                <button
                  onClick={handleDownloadCsv}
                  className="download-csv-btn"
                >
                  📥 Download CSV Export
                </button>
              </div>
            </div>

            <div className="batch-results-grid">
              {Object.entries(batchResults).map(([isbn, result]) => {
                // Normalize data structure - handle both regular batch scraping and CSV upload workflows
                const isSuccess = result.found !== undefined ? result.found : result.scrapeSuccess;
                const hasError = result.error;
                const duration = result.duration || 0;

                return (
                  <div key={isbn} className={`batch-result-item ${isSuccess ? 'success' : 'failed'}`}>
                    <div className="result-header">
                      <span className="result-isbn">{isbn}</span>
                      <span className={`result-status ${isSuccess ? 'success' : 'failed'}`}>
                        {isSuccess ? '✓ Success' : '✗ Failed'}
                      </span>
                    </div>

                    <div className="result-details">
                      <div className="result-timing">
                        <span className="timing-label">Duration:</span>
                        <span className="timing-value">{(duration / 1000).toFixed(2)}s</span>
                      </div>

                      {/* Show additional status for CSV upload workflow */}
                      {result.aiSuccess !== undefined && (
                        <div className="result-status-details">
                          <span className={`status-indicator ${result.aiSuccess ? 'success' : 'failed'}`}>
                            AI: {result.aiSuccess ? '✓' : '✗'}
                          </span>
                          <span className={`status-indicator ${result.csvSuccess ? 'success' : 'failed'}`}>
                            CSV: {result.csvSuccess ? '✓' : (result.csvDuplicate ? '⚠' : '✗')}
                          </span>
                        </div>
                      )}

                      {/* Show book data if available from CSV upload workflow */}
                      {result.bookData && (
                        <div className="result-book-data">
                          <div className="book-info">
                            <strong>{result.bookData.title}</strong>
                            {result.bookData.author && <div>by {result.bookData.author}</div>}
                          </div>
                        </div>
                      )}

                      {isSuccess && (
                        <div className="result-actions">
                          <button
                            className="view-details-btn"
                            onClick={() => {
                              if (result.bookData) {
                                // For CSV upload workflow, use existing book data
                                const bookDataStr = JSON.stringify(result.bookData, null, 2);
                                const structuredPrompt = `Book data already extracted for ISBN ${isbn}:\n\n${bookDataStr}\n\nYou can modify or enhance this data if needed.`;
                                setPrompt(structuredPrompt);
                              } else if (result.html) {
                                // For regular batch scraping workflow, parse HTML
                                const parsedText = parseHtmlContent(result.html);
                                const structuredPrompt = `Please analyze this book information from Libraccio and extract the metadata:

${parsedText}

Please provide a JSON response with the following book metadata:
- title
- author
- publisher
- pages
- edition_year
- isbn
- description
`;
                                setPrompt(structuredPrompt);
                              } else {
                                // Fallback for when there's no HTML content or book data
                                const fallbackPrompt = `Please help analyze book information for ISBN: ${isbn}`;
                                setPrompt(fallbackPrompt);
                              }
                            }}
                          >
                            Load to AI Prompt
                          </button>
                        </div>
                      )}

                      {hasError && (
                        <div className="result-error">
                          <span className="error-label">Error:</span>
                          <span className="error-message">{result.error}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="documentation-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <h3 style={{ margin: 0 }}>Documentation & API Usage:</h3>
            <button
              onClick={() => setShowDocumentation(!showDocumentation)}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: showDocumentation ? '#dc3545' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {showDocumentation ? 'Hide' : 'Show'}
            </button>
          </div>
          {showDocumentation && (
            <div className="documentation-content" style={{
              backgroundColor: '#f8f9fa',
              padding: '20px',
              borderRadius: '8px',
              fontSize: '14px',
              lineHeight: '1.6',
              color: 'black'
            }}>
              <h4 style={{ marginTop: 0, color: '#495057' }}>📚 How to Use This Application</h4>

              <div style={{ marginBottom: '20px' }}>
                <h5 style={{ color: '#6c757d', marginBottom: '8px' }}>🖥️ Web Interface Usage:</h5>
                <ul style={{ paddingLeft: '20px', margin: 0 }}>
                  <li><strong>Single ISBN:</strong> Enter one ISBN in the search field</li>
                  <li><strong>Multiple ISBNs:</strong> Enter multiple ISBNs separated by commas, spaces, or new lines</li>
                  <li><strong>CSV Upload:</strong> Upload a CSV file with ISBN column for bulk processing</li>
                  <li><strong>Automatic Processing:</strong> The system will automatically scrape → AI process → save to CSV</li>
                  <li><strong>Results:</strong> View AI-extracted book metadata and CSV save status</li>
                  <li><strong>Download:</strong> Use "Download CSV Export" to get your data</li>
                </ul>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h5 style={{ color: '#6c757d', marginBottom: '8px' }}>🔌 API Endpoints:</h5>
                <div style={{ backgroundColor: '#e9ecef', padding: '12px', borderRadius: '4px', marginBottom: '12px' }}>
                  <strong>Full Workflow API:</strong> <code>POST /api/full-workflow</code>
                  <br />
                  <small style={{ color: '#6c757d' }}>Complete automation: scraping + AI processing + CSV saving</small>
                </div>
                <div style={{ backgroundColor: '#e9ecef', padding: '12px', borderRadius: '4px', marginBottom: '12px' }}>
                  <strong>CSV Upload API:</strong> <code>POST /api/upload-csv-workflow</code>
                  <br />
                  <small style={{ color: '#6c757d' }}>Upload CSV file with ISBNs for bulk processing</small>
                </div>

                <p style={{ margin: '8px 0', fontWeight: 'bold' }}>Single ISBN:</p>
                <pre style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px', fontSize: '12px', overflow: 'auto' }}>
{`curl -X POST http://localhost:3001/api/full-workflow \\
  -H "Content-Type: application/json" \\
  -d '{"isbn": "9788807883453"}'`}
                </pre>

                <p style={{ margin: '8px 0', fontWeight: 'bold' }}>Multiple ISBNs:</p>
                <pre style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px', fontSize: '12px', overflow: 'auto' }}>
{`curl -X POST http://localhost:3001/api/full-workflow \\
  -H "Content-Type: application/json" \\
  -d '{"isbns": ["9788807883453", "9780123456789"]}'`}
                </pre>

                <p style={{ margin: '8px 0', fontWeight: 'bold' }}>CSV Upload:</p>
                <pre style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px', fontSize: '12px', overflow: 'auto' }}>
{`curl -X POST http://localhost:3001/api/upload-csv-workflow \\
  -F "csvFile=@/path/to/your/isbns.csv"`}
                </pre>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h5 style={{ color: '#6c757d', marginBottom: '8px' }}>📋 Other Available APIs:</h5>
                <ul style={{ paddingLeft: '20px', margin: 0 }}>
                  <li><code>POST /api/scrape-libraccio</code> - Scrape single ISBN</li>
                  <li><code>POST /api/scrape-libraccio-batch</code> - Scrape multiple ISBNs</li>
                  <li><code>POST /api/openrouter</code> - AI processing with custom prompt</li>
                  <li><code>POST /api/save-to-csv</code> - Save AI response to CSV</li>
                  <li><code>GET /api/download-csv</code> - Download CSV file</li>
                </ul>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h5 style={{ color: '#6c757d', marginBottom: '8px' }}>🎯 Response Format:</h5>
                <pre style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px', fontSize: '11px', overflow: 'auto' }}>
{`{
  "results": {
    "9788807883453": {
      "isbn": "9788807883453",
      "scrapeSuccess": true,
      "aiSuccess": true,
      "csvSuccess": true,
      "bookData": {
        "title": "Book Title",
        "author": "Author Name",
        "publisher": "Publisher",
        "pages": "300",
        "edition_year": "2023",
        "isbn": "9788807883453",
        "description": "Book description..."
      },
      "csvDuplicate": false,
      "duration": 3450,
      "error": null
    }
  },
  "summary": {
    "total": 1,
    "scrapeSuccessful": 1,
    "aiSuccessful": 1,
    "csvSuccessful": 1,
    "failed": 0,
    "totalDuration": 3450,
    "averageDuration": 3450
  }
}`}
                </pre>
              </div>

              <div>
                <h5 style={{ color: '#6c757d', marginBottom: '8px' }}>⚙️ Features:</h5>
                <ul style={{ paddingLeft: '20px', margin: 0 }}>
                  <li>✅ Automatic HTML scraping from Libraccio</li>
                  <li>✅ AI-powered metadata extraction</li>
                  <li>✅ Dynamic CSV generation with all extracted fields</li>
                  <li>✅ Duplicate detection and handling</li>
                  <li>✅ Batch processing up to 50 ISBNs</li>
                  <li>✅ CSV file upload with drag & drop support</li>
                  <li>✅ Automatic ISBN column detection</li>
                  <li>✅ Detailed success/failure tracking</li>
                  <li>✅ Performance metrics and timing</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
