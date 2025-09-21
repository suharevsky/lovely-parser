import { useState } from 'react'
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
        <form onSubmit={handleSubmit} className="prompt-form">
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

        <div className="divider">
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

          <div className="input-group">
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

        {tokenUsage && (
          <div className="token-usage-section">
            <h3>Token Usage</h3>
            <div className="token-stats">
              <div className="token-stat">
                <span className="token-label">Input Tokens:</span>
                <span className="token-value">{tokenUsage.promptTokens}</span>
              </div>
              <div className="token-stat">
                <span className="token-label">Output Tokens:</span>
                <span className="token-value">{tokenUsage.responseTokens}</span>
              </div>
              <div className="token-stat">
                <span className="token-label">Total This Request:</span>
                <span className="token-value">{tokenUsage.totalTokens}</span>
              </div>
              <div className="token-stat session-total">
                <span className="token-label">Session Total:</span>
                <span className="token-value">{totalTokensUsed}</span>
              </div>
            </div>
            <button onClick={resetTokenCounter} className="reset-button">
              Reset Counter
            </button>
          </div>
        )}

        {processDuration !== null && (
          <div className="timing-section">
            <h3>⏱️ Process Timing</h3>
            <div className="timing-info">
              <div className="timing-detail">
                <span className="timing-label">Process Type:</span>
                <span className="timing-value">{processType}</span>
              </div>
              <div className="timing-detail">
                <span className="timing-label">Duration:</span>
                <span className="timing-value">{(processDuration / 1000).toFixed(3)} seconds</span>
              </div>
              <div className="timing-detail">
                <span className="timing-label">Total Time:</span>
                <span className="timing-value">{processDuration} ms</span>
              </div>
            </div>
          </div>
        )}

        {response && (
          <div className="response-section">
            <h3>AI Response:</h3>
            <div className="response-content">
              <pre>{typeof response === 'object' ? JSON.stringify(response, null, 2) : response}</pre>
            </div>
            <div className="response-actions">
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
          </div>
        )}

        {scrapeResult && (
          <div className="response-section">
            <h3>Libraccio Scrape Result:</h3>
            <div className="response-content">
              <pre>{scrapeResult}</pre>
            </div>
          </div>
        )}

        {batchSummary && Object.keys(batchResults).length > 0 && (
          <div className="batch-results-section">
            <h3>Batch Processing Results</h3>

            <div className="batch-summary">
              <div className="summary-stats">
                <div className="summary-stat success">
                  <span className="stat-label">Successful:</span>
                  <span className="stat-value">{batchSummary.successful}</span>
                </div>
                <div className="summary-stat failed">
                  <span className="stat-label">Failed:</span>
                  <span className="stat-value">{batchSummary.failed}</span>
                </div>
                <div className="summary-stat total">
                  <span className="stat-label">Total:</span>
                  <span className="stat-value">{batchSummary.total}</span>
                </div>
                <div className="summary-stat duration">
                  <span className="stat-label">Total Duration:</span>
                  <span className="stat-value">{(batchSummary.totalDuration / 1000).toFixed(2)}s</span>
                </div>
                <div className="summary-stat average">
                  <span className="stat-label">Avg per ISBN:</span>
                  <span className="stat-value">{(batchSummary.averageDuration / 1000).toFixed(2)}s</span>
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
              {Object.entries(batchResults).map(([isbn, result]) => (
                <div key={isbn} className={`batch-result-item ${result.found ? 'success' : 'failed'}`}>
                  <div className="result-header">
                    <span className="result-isbn">{isbn}</span>
                    <span className={`result-status ${result.found ? 'success' : 'failed'}`}>
                      {result.found ? '✓ Found' : '✗ Failed'}
                    </span>
                  </div>

                  <div className="result-details">
                    <div className="result-timing">
                      <span className="timing-label">Duration:</span>
                      <span className="timing-value">{(result.duration / 1000).toFixed(2)}s</span>
                    </div>

                    {result.found && (
                      <div className="result-actions">
                        <button
                          className="view-details-btn"
                          onClick={() => {
                            if (!result.html) {
                              // Fallback for when there's no HTML content
                              const fallbackPrompt = `Please help analyze book information for ISBN: ${isbn}`;
                              setPrompt(fallbackPrompt);
                              return;
                            }

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
                          }}
                        >
                          Load to AI Prompt
                        </button>
                      </div>
                    )}

                    {result.error && (
                      <div className="result-error">
                        <span className="error-label">Error:</span>
                        <span className="error-message">{result.error}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
