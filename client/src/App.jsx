import { useState } from 'react'
import './App.css'

function App() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [totalTokensUsed, setTotalTokensUsed] = useState(0)

  const resetTokenCounter = () => {
    setTotalTokensUsed(0)
    setTokenUsage(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setResponse('')
    setTokenUsage(null)

    const enhancedPrompt = prompt + "\n\ngive me json response metadata of the books like: title, author, publisher, pages, description, edition_year, isbn, libraccio_image_src,"
    //const enhancedPrompt = prompt;
    try {
      const res = await fetch('http://localhost:3001/api/gemini', {
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gemini AI Assistant</h1>
        <p>Enter your prompt below to generate content using Google's Gemini 1.5 Flash Lite model</p>
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

        {response && (
          <div className="response-section">
            <h3>Response:</h3>
            <div className="response-content">
              <pre>{response}</pre>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
