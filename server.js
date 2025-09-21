const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// CSV configuration
const CSV_FILE_PATH = path.join(__dirname, 'ai_responses.csv');

// Helper function to generate hash for uniqueness
function generateResponseHash(isbn, aiResponse) {
  const content = `${isbn}|${aiResponse.replace(/\s+/g, ' ').trim()}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

// Helper function to check if record already exists
async function checkRecordExists(hash) {
  try {
    if (!fs.existsSync(CSV_FILE_PATH)) {
      return false;
    }

    const csvContent = fs.readFileSync(CSV_FILE_PATH, 'utf8');
    return csvContent.includes(hash);
  } catch (error) {
    console.error('Error checking existing records:', error);
    return false;
  }
}

// Helper function to parse JSON from AI response and extract all keys
function parseBookDataFromResponse(aiResponse) {
  try {
    // First try to parse as direct JSON (for new object format from frontend)
    const parsed = JSON.parse(aiResponse);
    // Return all keys from the parsed JSON, ensuring string values
    const result = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = String(value || '');
    }
    return result;
  } catch (firstError) {
    try {
      // Fallback: try to extract JSON from text (for legacy string responses)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Return all keys from the parsed JSON, ensuring string values
        const result = {};
        for (const [key, value] of Object.entries(parsed)) {
          result[key] = String(value || '');
        }
        return result;
      }
    } catch (secondError) {
      // Could not parse JSON from AI response, using defaults
    }
  }

  // Return empty object if parsing fails
  return {};
}

// Helper function to create dynamic CSV writer
function createDynamicCsvWriter(headers, writeHeaders = false) {
  return createCsvWriter({
    path: CSV_FILE_PATH,
    header: headers,
    append: !writeHeaders,  // Don't append if we need to write headers
    writeHeaders: writeHeaders  // Write headers only when needed
  });
}

// Helper function to check if CSV file exists and has headers
function csvFileNeedsHeaders() {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    return true;  // File doesn't exist, needs headers
  }

  const stats = fs.statSync(CSV_FILE_PATH);
  return stats.size === 0;  // File exists but is empty, needs headers
}

app.post('/api/openrouter', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-flash-1.5-8b',
        messages: [{
          role: 'user',
          content: prompt
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3001'
        }
      }
    );

    const generatedText = response.data.choices[0].message.content;
    const tokenUsage = response.data.usage;

    // Parse the JSON response to match tokenUsage format
    let parsedResponse;
    try {
      // First try to parse as-is
      parsedResponse = JSON.parse(generatedText);
    } catch (parseError) {
      try {
        // Try to extract JSON from markdown code blocks or other formatting
        const jsonMatch = generatedText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ||
                         generatedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonString = jsonMatch[1] || jsonMatch[0];
          parsedResponse = JSON.parse(jsonString);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (secondParseError) {
        // If both attempts fail, return the original text as an error structure
        parsedResponse = {
          error: "Failed to parse JSON response",
          originalText: generatedText
        };
      }
    }

    res.json({
      response: parsedResponse,
      tokenUsage: tokenUsage ? {
        promptTokens: tokenUsage.prompt_tokens,
        responseTokens: tokenUsage.completion_tokens,
        totalTokens: tokenUsage.total_tokens
      } : null
    });

  } catch (error) {
    console.error('Error calling OpenRouter API:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to generate content',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

app.post('/api/save-to-csv', async (req, res) => {
  try {
    const { isbn, aiResponse } = req.body;

    if (!isbn || !aiResponse) {
      return res.status(400).json({ error: 'ISBN and AI response are required' });
    }

    // Generate hash for uniqueness check
    const responseHash = generateResponseHash(isbn, aiResponse);

    // Check if record already exists
    const exists = await checkRecordExists(responseHash);
    if (exists) {
      return res.json({
        success: true,
        message: 'Record already exists in CSV',
        duplicate: true
      });
    }

    // Parse book data from AI response (gets all JSON keys dynamically)
    const bookData = parseBookDataFromResponse(aiResponse);

    // Use only book data for CSV record (no metadata columns)
    const record = bookData;

    // Create dynamic headers based only on book data keys
    const headers = Object.keys(bookData).map(key => ({
      id: key,
      title: key
    }));

    // Check if we need to write headers (new file or empty file)
    const needsHeaders = csvFileNeedsHeaders();

    // Create dynamic CSV writer
    const csvWriter = createDynamicCsvWriter(headers, needsHeaders);

    // Write to CSV
    await csvWriter.writeRecords([record]);

    res.json({
      success: true,
      message: 'Record saved to CSV successfully',
      duplicate: false,
      record: record,
      headers: headers.map(h => h.title), // Return headers for debugging
      bookData: bookData, // Debug: show what was parsed from JSON
      needsHeaders: needsHeaders // Debug: show if headers were written
    });

  } catch (error) {
    console.error('Error saving to CSV:', error);
    res.status(500).json({
      error: 'Failed to save to CSV',
      details: error.message
    });
  }
});

app.get('/api/download-csv', (req, res) => {
  try {
    if (!fs.existsSync(CSV_FILE_PATH)) {
      return res.status(404).json({ error: 'CSV file not found' });
    }

    res.download(CSV_FILE_PATH, 'ai_responses.csv', (err) => {
      if (err) {
        console.error('Error downloading CSV:', err);
        res.status(500).json({ error: 'Failed to download CSV' });
      }
    });
  } catch (error) {
    console.error('Error downloading CSV:', error);
    res.status(500).json({ error: 'Failed to download CSV' });
  }
});

// Helper function to scrape a single ISBN
const scrapeSingleISBN = async (isbn) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    // Use the real scraper for actual data
    const scraperPath = path.join(__dirname, 'libraccio_scraper_real.py');

    const pythonProcess = spawn('python3', [scraperPath, isbn, '--headless'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      pythonProcess.kill();
      resolve({
        isbn,
        success: false,
        error: 'Timeout - request took too long',
        duration: Date.now() - startTime
      });
    }, 15000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          isbn,
          success: false,
          error: stderr || 'Unknown error occurred',
          duration
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const filteredResult = {
          found: result.found,
          html: result.html
        };
        resolve({
          isbn,
          success: true,
          data: filteredResult,
          duration
        });
      } catch (parseError) {
        resolve({
          isbn,
          success: false,
          error: 'Failed to parse scraper response',
          duration
        });
      }
    });
  });
};

app.post('/api/scrape-libraccio-batch', async (req, res) => {
  try {
    const { isbns } = req.body;

    if (!isbns || !Array.isArray(isbns) || isbns.length === 0) {
      return res.status(400).json({ error: 'ISBNs array is required' });
    }

    if (isbns.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 ISBNs allowed per batch' });
    }

    const startTime = Date.now();
    const results = {};
    let successful = 0;
    let failed = 0;

    // Process ISBNs sequentially to avoid overwhelming the server
    for (const isbn of isbns) {
      const result = await scrapeSingleISBN(isbn.trim());

      if (result.success) {
        results[result.isbn] = {
          ...result.data,
          duration: result.duration
        };
        successful++;
      } else {
        results[result.isbn] = {
          found: false,
          error: result.error,
          duration: result.duration
        };
        failed++;
      }
    }

    const totalDuration = Date.now() - startTime;

    res.json({
      results,
      summary: {
        total: isbns.length,
        successful,
        failed,
        totalDuration,
        averageDuration: Math.round(totalDuration / isbns.length)
      }
    });

  } catch (error) {
    console.error('Batch scraping endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

app.post('/api/scrape-libraccio', async (req, res) => {
  try {
    const { isbn } = req.body;

    if (!isbn) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const scraperPath = path.join(__dirname, 'libraccio_scraper_real.py');

    const pythonProcess = spawn('python3', [scraperPath, isbn, '--headless'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    let responsesSent = false;

    pythonProcess.on('close', (code) => {
      if (responsesSent) return;
      responsesSent = true;

      if (code !== 0) {
        console.error('Python script error:', stderr);
        return res.status(500).json({
          error: 'Scraping failed',
          details: stderr || 'Unknown error occurred'
        });
      }

      try {
        const result = JSON.parse(stdout);
        const filteredResult = {
          found: result.found,
          html: result.html
        };
        res.json(filteredResult);
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Raw output:', stdout);
        res.status(500).json({
          error: 'Failed to parse scraper response',
          details: parseError.message,
          rawOutput: stdout
        });
      }
    });

    const timeout = setTimeout(() => {
      if (responsesSent) return;
      responsesSent = true;
      pythonProcess.kill();
      res.status(408).json({ error: 'Scraping timeout - request took too long' });
    }, 15000);

  } catch (error) {
    console.error('Scraping endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});