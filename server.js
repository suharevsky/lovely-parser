const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { JSDOM } = require('jsdom');
const multer = require('multer');
const csvParser = require('csv-parser');
const { SUPPORTED_SITES, DEFAULT_SITE, getSite, getAllSites } = require('./sites-config');
require('dotenv').config();

// Chunking Manager Class
class ChunkManager {
  constructor() {
    this.jobs = new Map(); // Store job progress and results
    this.eventListeners = new Map(); // Store SSE connections
  }

  generateJobId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  createJob(isbns, chunkSize = 50) {
    const jobId = this.generateJobId();
    const chunks = this.createChunks(isbns, chunkSize);

    const job = {
      id: jobId,
      status: 'pending', // pending, processing, completed, failed, cancelled
      isbns: isbns,
      chunks: chunks,
      currentChunk: 0,
      totalChunks: chunks.length,
      results: {},
      summary: {
        total: isbns.length,
        processed: 0,
        successful: 0,
        scrapeSuccessful: 0,
        aiSuccessful: 0,
        csvSuccessful: 0,
        failed: 0
      },
      startTime: Date.now(),
      endTime: null,
      error: null
    };

    this.jobs.set(jobId, job);
    return job;
  }

  createChunks(isbns, chunkSize) {
    const chunks = [];
    for (let i = 0; i < isbns.length; i += chunkSize) {
      chunks.push(isbns.slice(i, i + chunkSize));
    }
    return chunks;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  updateJobProgress(jobId, chunkIndex, chunkResults) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    // Update results
    Object.assign(job.results, chunkResults);

    // Update summary
    Object.values(chunkResults).forEach(result => {
      job.summary.processed++;
      if (result.scrapeSuccess) job.summary.scrapeSuccessful++;
      if (result.aiSuccess) job.summary.aiSuccessful++;
      if (result.csvSuccess) job.summary.csvSuccessful++;
      if (result.error) job.summary.failed++;
    });

    job.summary.successful = job.summary.scrapeSuccessful;
    job.currentChunk = chunkIndex + 1;

    // Send progress update via SSE
    this.broadcastProgress(jobId);

    return job;
  }

  completeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    job.status = 'completed';
    job.endTime = Date.now();

    // Send completion notification
    this.broadcastProgress(jobId);

    return job;
  }

  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    job.status = 'failed';
    job.error = error;
    job.endTime = Date.now();

    // Send failure notification
    this.broadcastProgress(jobId);

    return job;
  }

  addEventListener(jobId, res) {
    if (!this.eventListeners.has(jobId)) {
      this.eventListeners.set(jobId, []);
    }
    this.eventListeners.get(jobId).push(res);
  }

  removeEventListener(jobId, res) {
    const listeners = this.eventListeners.get(jobId);
    if (listeners) {
      const index = listeners.indexOf(res);
      if (index > -1) {
        listeners.splice(index, 1);
      }
      if (listeners.length === 0) {
        this.eventListeners.delete(jobId);
      }
    }
  }

  broadcastProgress(jobId) {
    const job = this.jobs.get(jobId);
    const listeners = this.eventListeners.get(jobId);

    if (job && listeners) {
      const progressData = {
        jobId: job.id,
        status: job.status,
        currentChunk: job.currentChunk,
        totalChunks: job.totalChunks,
        summary: job.summary,
        progress: Math.round((job.summary.processed / job.summary.total) * 100),
        eta: this.calculateETA(job)
      };

      listeners.forEach(res => {
        try {
          res.write(`data: ${JSON.stringify(progressData)}\n\n`);
        } catch (error) {
          console.error('Error sending SSE data:', error);
        }
      });
    }
  }

  calculateETA(job) {
    if (job.summary.processed === 0) return null;

    const elapsed = Date.now() - job.startTime;
    const avgTimePerItem = elapsed / job.summary.processed;
    const remaining = job.summary.total - job.summary.processed;

    return Math.round(remaining * avgTimePerItem);
  }

  cleanupOldJobs() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.endTime && (now - job.endTime) > maxAge) {
        this.jobs.delete(jobId);
        this.eventListeners.delete(jobId);
      }
    }
  }
}

// Global chunk manager instance
const chunkManager = new ChunkManager();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS to allow all origins and handle preflight requests
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Multer configuration for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// CSV configuration
const CSV_FILE_PATH = path.join(__dirname, 'ai_responses.csv');

// Helper function to generate hash for uniqueness
function generateResponseHash(isbn, aiResponse) {
  const content = `${isbn}|${aiResponse.replace(/\s+/g, ' ').trim()}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

// Helper function to check if ISBN already exists in CSV
async function checkIsbnExists(isbn) {
  try {
    if (!fs.existsSync(CSV_FILE_PATH)) {
      return false;
    }

    const csvContent = fs.readFileSync(CSV_FILE_PATH, 'utf8');
    const lines = csvContent.split('\n');

    // Skip header and empty lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // Parse CSV line and look for ISBN column
        const columns = line.split(',');
        // ISBN should be in the 6th column (index 5) based on: title,author,publisher,pages,edition_year,isbn,description
        if (columns.length >= 6) {
          const existingIsbn = columns[5].replace(/"/g, '').trim();
          if (existingIsbn === isbn) {
            return true;
          }
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking existing ISBN:', error);
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

// Helper function to parse HTML and extract readable text (server-side version)
function parseHtmlContent(htmlString) {
  try {
    // Create JSDOM instance to parse HTML
    const dom = new JSDOM(htmlString);
    const document = dom.window.document;

    // Remove script and style elements
    const scripts = document.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());

    // Get text content and clean it up
    let textContent = document.body.textContent || document.body.innerText || '';

    // Clean up the text: remove extra whitespace, normalize line breaks
    textContent = textContent
      .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n')  // Remove empty lines
      .trim();

    return textContent;
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return 'Error parsing HTML content';
  }
}

// Helper function to parse CSV file and extract ISBNs
function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const isbns = [];
    const detectedColumns = [];
    let headerProcessed = false;
    let isbnColumnIndex = -1;

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('headers', (headers) => {
        detectedColumns.push(...headers);

        // Try to find ISBN column with flexible matching
        const isbnPatterns = /^(isbn|isbn13|isbn10|book_isbn|bookisbn)$/i;
        isbnColumnIndex = headers.findIndex(header => isbnPatterns.test(header.trim()));

        // If no exact match, try partial matching
        if (isbnColumnIndex === -1) {
          isbnColumnIndex = headers.findIndex(header =>
            header.toLowerCase().includes('isbn')
          );
        }

        headerProcessed = true;
      })
      .on('data', (row) => {
        if (!headerProcessed) return;

        let isbn = '';

        if (isbnColumnIndex >= 0) {
          // Use detected ISBN column
          const columnName = detectedColumns[isbnColumnIndex];
          isbn = row[columnName];
        } else {
          // Try to find ISBN in any column by pattern matching
          for (const [key, value] of Object.entries(row)) {
            if (value && /^[0-9\-Xx]{10,17}$/.test(value.toString().trim())) {
              isbn = value;
              break;
            }
          }
        }

        if (isbn) {
          const cleanIsbn = isbn.toString().trim();
          if (cleanIsbn && /^[0-9\-Xx]{10,17}$/.test(cleanIsbn)) {
            isbns.push(cleanIsbn);
          }
        }
      })
      .on('end', () => {
        // Remove duplicates
        const uniqueIsbns = [...new Set(isbns)];
        resolve({
          isbns: uniqueIsbns,
          totalFound: uniqueIsbns.length,
          detectedColumns,
          isbnColumnDetected: isbnColumnIndex >= 0 ? detectedColumns[isbnColumnIndex] : null
        });
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Universal scraper using Jina AI Reader
const scrapeWithJina = async (isbn, site) => {
  const startTime = Date.now();

  try {
    const bookUrl = site.urlPattern.replace('{isbn}', isbn);
    const jinaUrl = `https://r.jina.ai/${bookUrl}`;

    console.log(`[Jina Scraper] Fetching from ${site.name}: ${jinaUrl}`);

    const response = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-With-Generated-Alt': 'true'
      },
      timeout: 15000
    });

    const cleanedContent = response.data;
    console.log(`[Jina Scraper] Success - Content length: ${cleanedContent.length} chars from ${site.name}`);

    return {
      isbn,
      success: true,
      data: {
        found: true,
        html: cleanedContent,
        text: cleanedContent,
        source: site.name,
        siteId: site.id
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    console.error(`[Jina Scraper] Error scraping ${site.name}:`, error.message);
    return {
      isbn,
      success: false,
      error: `Failed to scrape from ${site.name}: ${error.message}`,
      duration: Date.now() - startTime
    };
  }
};

// Decitre.fr scraper - parses specific HTML class
const scrapeWithDecitre = async (isbn, site) => {
  const startTime = Date.now();

  try {
    const bookUrl = site.urlPattern.replace('{isbn}', isbn);
    console.log(`[Decitre Scraper] Fetching from ${site.name}: ${bookUrl}`);

    const response = await axios.get(bookUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 15000
    });

    // Parse HTML with JSDOM
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    // Extract description from the specific class
    const synopsysElement = document.querySelector('.product-summary-synopsys');
    let description = '';

    if (synopsysElement) {
      description = synopsysElement.textContent.trim();
      console.log(`[Decitre Scraper] Success - Found description: ${description.length} chars from ${site.name}`);
    } else {
      console.log(`[Decitre Scraper] Warning - No element with class 'product-summary-synopsys' found`);
    }

    // Extract additional book information if needed
    const titleElement = document.querySelector('h1');
    const title = titleElement ? titleElement.textContent.trim() : '';

    // Create a structured text output similar to Jina format
    const cleanedContent = `Title: ${title}\n\nDescription: ${description}`;

    return {
      isbn,
      success: true,
      data: {
        found: !!synopsysElement,
        html: cleanedContent,
        text: cleanedContent,
        description: description,
        source: site.name,
        siteId: site.id
      },
      duration: Date.now() - startTime
    };
  } catch (error) {
    console.error(`[Decitre Scraper] Error scraping ${site.name}:`, error.message);
    return {
      isbn,
      success: false,
      error: `Failed to scrape from ${site.name}: ${error.message}`,
      duration: Date.now() - startTime
    };
  }
};

// Helper function to scrape a single ISBN from Python scraper
const scrapeWithPython = async (isbn, site) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
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
          html: result.html,
          source: site.name,
          siteId: site.id
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

// Helper function to process full workflow for a single ISBN
const processFullWorkflow = async (isbn, siteId = DEFAULT_SITE) => {
  const startTime = Date.now();
  const result = {
    isbn,
    scrapeSuccess: false,
    aiSuccess: false,
    csvSuccess: false,
    bookData: null,
    csvDuplicate: false,
    duration: 0,
    error: null
  };

  try {
    // Step 1: Get site configuration and scrape the ISBN
    const site = getSite(siteId);
    console.log(`[Workflow] Starting scrape for ISBN ${isbn} from ${site.name}`);

    let scrapeResult;
    if (site.scraper === 'jina') {
      scrapeResult = await scrapeWithJina(isbn, site);
    } else if (site.scraper === 'python') {
      scrapeResult = await scrapeWithPython(isbn, site);
    } else if (site.scraper === 'decitre') {
      scrapeResult = await scrapeWithDecitre(isbn, site);
    } else {
      result.error = `Unknown scraper type: ${site.scraper}`;
      result.duration = Date.now() - startTime;
      return result;
    }

    if (!scrapeResult.success) {
      result.error = scrapeResult.error;
      result.duration = Date.now() - startTime;
      return result;
    }

    result.scrapeSuccess = true;
    result.source = scrapeResult.data.source; // Store source site

    // Step 2: Check if we have content to process
    if (!scrapeResult.data.found || !scrapeResult.data.html) {
      result.error = 'No content found for this ISBN';
      result.duration = Date.now() - startTime;
      return result;
    }

    // Step 3: Extract cleaned content (already cleaned by Jina, Decitre, or Python scraper)
    let cleanedContent = '';
    if (site.scraper === 'jina' || site.scraper === 'decitre') {
      // Jina and Decitre already provide cleaned content
      cleanedContent = scrapeResult.data.html;
    } else {
      // For Python scraper, parse HTML to extract text
      cleanedContent = parseHtmlContent(scrapeResult.data.html);
    }

    // Step 4: Create structured prompt for AI (using cleaned content)
    const structuredPrompt = `Please analyze this book information from Libraccio and extract the metadata:

${cleanedContent.substring(0, 8000)}

Please provide a JSON response with the following book metadata:
- title
- author
- publisher
- pages
- edition_year
- isbn
- description
`;

    // Step 5: Process with AI
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        result.error = 'OPENROUTER_API_KEY not configured';
        result.duration = Date.now() - startTime;
        return result;
      }

      console.log(1)
      const aiResponse = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'mistralai/ministral-3b',
          messages: [{
            role: 'user',
            content: structuredPrompt
          }],
          max_tokens: 1500  // Limit response tokens to prevent excessive usage
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3001'
          }
        }
      );

      const generatedText = aiResponse.data.choices[0].message.content;

      // Parse the AI response
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(generatedText);
      } catch (parseError) {
        try {
          const jsonMatch = generatedText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ||
                           generatedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const jsonString = jsonMatch[1] || jsonMatch[0];
            parsedResponse = JSON.parse(jsonString);
          } else {
            throw new Error("No JSON found in response");
          }
        } catch (secondParseError) {
          result.error = 'Failed to parse AI response as JSON';
          result.duration = Date.now() - startTime;
          return result;
        }
      }

      result.aiSuccess = true;
      result.bookData = parsedResponse;

      // Step 6: Save to CSV
      try {
        // Check if ISBN already exists in CSV
        const exists = await checkIsbnExists(isbn);
        if (exists) {
          result.csvSuccess = true;
          result.csvDuplicate = true;
        } else {
          // Parse book data from AI response
          const bookData = parseBookDataFromResponse(JSON.stringify(parsedResponse));

          // Create dynamic headers based only on book data keys
          const headers = Object.keys(bookData).map(key => ({
            id: key,
            title: key
          }));

          // Check if we need to write headers
          const needsHeaders = csvFileNeedsHeaders();

          // Create dynamic CSV writer and save
          const csvWriter = createDynamicCsvWriter(headers, needsHeaders);
          await csvWriter.writeRecords([bookData]);

          result.csvSuccess = true;
          result.csvDuplicate = false;
        }
      } catch (csvError) {
        result.error = `CSV save failed: ${csvError.message}`;
        result.duration = Date.now() - startTime;
        return result;
      }

    } catch (aiError) {
      result.error = `AI processing failed: ${aiError.response?.data?.error?.message || aiError.message}`;
      result.duration = Date.now() - startTime;
      return result;
    }

  } catch (error) {
    result.error = `Workflow failed: ${error.message}`;
  }

  result.duration = Date.now() - startTime;
  return result;
};

app.post('/api/upload-csv-workflow', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const filePath = req.file.path;

    try {
      // Parse the CSV file
      const parseResult = await parseCSVFile(filePath);

      if (parseResult.isbns.length === 0) {
        return res.status(400).json({
          error: 'No valid ISBNs found in the CSV file',
          details: 'Please ensure your CSV contains a column with ISBN values',
          detectedColumns: parseResult.detectedColumns
        });
      }

      if (parseResult.isbns.length > 50) {
        return res.status(400).json({
          error: 'Too many ISBNs found',
          details: `Found ${parseResult.isbns.length} ISBNs, but maximum allowed is 50`
        });
      }

      // Process the ISBNs through the full workflow
      const startTime = Date.now();
      const results = {};
      let scrapeSuccessful = 0;
      let aiSuccessful = 0;
      let csvSuccessful = 0;
      let failed = 0;

      // Process ISBNs sequentially to avoid overwhelming the server
      for (const isbn of parseResult.isbns) {
        console.log(`Processing ISBN from CSV: ${isbn}`);

        const result = await processFullWorkflow(isbn);
        results[isbn] = result;

        // Update counters
        if (result.scrapeSuccess) scrapeSuccessful++;
        if (result.aiSuccess) aiSuccessful++;
        if (result.csvSuccess) csvSuccessful++;
        if (result.error) failed++;
      }

      const totalDuration = Date.now() - startTime;

      // Normalize the response for frontend compatibility
      const normalizedResults = {};
      for (const [isbn, result] of Object.entries(results)) {
        normalizedResults[isbn] = {
          ...result,
          // Add 'found' property for frontend compatibility with regular batch scraping
          found: result.scrapeSuccess,
          // Keep original properties for enhanced CSV upload display
          scrapeSuccess: result.scrapeSuccess,
          aiSuccess: result.aiSuccess,
          csvSuccess: result.csvSuccess,
          bookData: result.bookData,
          csvDuplicate: result.csvDuplicate
        };
      }

      const response = {
        results: normalizedResults,
        summary: {
          total: parseResult.isbns.length,
          successful: scrapeSuccessful, // Add 'successful' for frontend compatibility
          scrapeSuccessful,
          aiSuccessful,
          csvSuccessful,
          failed,
          totalDuration,
          averageDuration: Math.round(totalDuration / parseResult.isbns.length)
        },
        csvFileInfo: {
          filename: req.file.originalname,
          detectedColumns: parseResult.detectedColumns,
          isbnColumnDetected: parseResult.isbnColumnDetected,
          totalIsbnsFound: parseResult.totalFound
        }
      };

      res.json(response);

    } catch (parseError) {
      console.error('CSV parsing error:', parseError);
      res.status(400).json({
        error: 'Failed to parse CSV file',
        details: parseError.message
      });
    } finally {
      // Clean up uploaded file
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }

  } catch (error) {
    console.error('CSV upload workflow error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Chunked CSV Workflow - for files with >50 ISBNs
app.post('/api/chunked-csv-workflow', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const filePath = req.file.path;

    try {
      // Parse the CSV file
      const parseResult = await parseCSVFile(filePath);

      if (parseResult.isbns.length === 0) {
        return res.status(400).json({
          error: 'No valid ISBNs found in the CSV file',
          details: 'Please ensure your CSV contains a column with ISBN values',
          detectedColumns: parseResult.detectedColumns
        });
      }

      // Create chunked job
      const job = chunkManager.createJob(parseResult.isbns);

      // Return job ID immediately for client to start monitoring
      res.json({
        jobId: job.id,
        status: 'created',
        totalISBNs: parseResult.isbns.length,
        totalChunks: job.totalChunks,
        csvFileInfo: {
          filename: req.file.originalname,
          detectedColumns: parseResult.detectedColumns,
          isbnColumnDetected: parseResult.isbnColumnDetected,
          totalIsbnsFound: parseResult.totalFound
        }
      });

      // Start processing chunks asynchronously
      processChunkedJob(job.id);

    } catch (parseError) {
      console.error('CSV parsing error:', parseError);
      res.status(400).json({
        error: 'Failed to parse CSV file',
        details: parseError.message
      });
    } finally {
      // Clean up uploaded file
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }

  } catch (error) {
    console.error('Chunked CSV upload error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Process chunked job asynchronously
async function processChunkedJob(jobId) {
  const job = chunkManager.getJob(jobId);
  if (!job) return;

  job.status = 'processing';
  chunkManager.broadcastProgress(jobId);

  try {
    for (let chunkIndex = 0; chunkIndex < job.chunks.length; chunkIndex++) {
      const chunk = job.chunks[chunkIndex];
      console.log(`Processing chunk ${chunkIndex + 1}/${job.chunks.length} for job ${jobId}`);

      const chunkResults = {};

      // Process each ISBN in the chunk
      for (const isbn of chunk) {
        try {
          const result = await processFullWorkflow(isbn);
          chunkResults[isbn] = result;
        } catch (error) {
          console.error(`Error processing ISBN ${isbn}:`, error);
          chunkResults[isbn] = {
            isbn,
            scrapeSuccess: false,
            aiSuccess: false,
            csvSuccess: false,
            bookData: null,
            csvDuplicate: false,
            duration: 0,
            error: error.message
          };
        }
      }

      // Update job progress
      chunkManager.updateJobProgress(jobId, chunkIndex, chunkResults);

      // Small delay between chunks to prevent overwhelming
      if (chunkIndex < job.chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Mark job as completed
    chunkManager.completeJob(jobId);

  } catch (error) {
    console.error(`Error processing chunked job ${jobId}:`, error);
    chunkManager.failJob(jobId, error.message);
  }
}

// Server-Sent Events endpoint for progress tracking
app.get('/api/job-progress/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = chunkManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial job status
  const initialData = {
    jobId: job.id,
    status: job.status,
    currentChunk: job.currentChunk,
    totalChunks: job.totalChunks,
    summary: job.summary,
    progress: Math.round((job.summary.processed / job.summary.total) * 100),
    eta: chunkManager.calculateETA(job)
  };

  res.write(`data: ${JSON.stringify(initialData)}\n\n`);

  // Add this connection to the job's listeners
  chunkManager.addEventListener(jobId, res);

  // Handle client disconnect
  req.on('close', () => {
    chunkManager.removeEventListener(jobId, res);
  });

  req.on('error', () => {
    chunkManager.removeEventListener(jobId, res);
  });
});

// Get job status endpoint (alternative to SSE)
app.get('/api/job-status/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = chunkManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: job.id,
    status: job.status,
    currentChunk: job.currentChunk,
    totalChunks: job.totalChunks,
    summary: job.summary,
    progress: Math.round((job.summary.processed / job.summary.total) * 100),
    eta: chunkManager.calculateETA(job),
    results: job.status === 'completed' ? job.results : null,
    error: job.error
  });
});

// Cleanup old jobs periodically
setInterval(() => {
  chunkManager.cleanupOldJobs();
}, 60 * 60 * 1000); // Every hour

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

    console.log(2)
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'mistralai/ministral-3b',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: 1500  // Limit response tokens to prevent excessive usage
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

    // Check if ISBN already exists in CSV
    const exists = await checkIsbnExists(isbn);
    if (exists) {
      return res.json({
        success: true,
        message: 'Book with this ISBN already exists in CSV',
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

// Helper function to scrape a single ISBN (with site support)
const scrapeSingleISBN = async (isbn, siteId = DEFAULT_SITE) => {
  const site = getSite(siteId);

  if (site.scraper === 'jina') {
    return await scrapeWithJina(isbn, site);
  } else if (site.scraper === 'python') {
    return await scrapeWithPython(isbn, site);
  } else if (site.scraper === 'decitre') {
    return await scrapeWithDecitre(isbn, site);
  } else {
    return {
      isbn,
      success: false,
      error: `Unknown scraper type: ${site.scraper}`,
      duration: 0
    };
  }
};

app.post('/api/scrape-libraccio-batch', async (req, res) => {
  try {
    const { isbns, site } = req.body;
    const siteId = site || DEFAULT_SITE;

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
      const result = await scrapeSingleISBN(isbn.trim(), siteId);

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
    const { isbn, site } = req.body;
    const siteId = site || DEFAULT_SITE;

    if (!isbn) {
      return res.status(400).json({ error: 'ISBN is required' });
    }

    const result = await scrapeSingleISBN(isbn, siteId);

    if (result.success) {
      res.json({
        found: result.data.found,
        html: result.data.html,
        source: result.data.source,
        siteId: result.data.siteId
      });
    } else {
      res.status(500).json({
        error: 'Scraping failed',
        details: result.error
      });
    }

  } catch (error) {
    console.error('Scraping endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

app.post('/api/full-workflow', async (req, res) => {
  try {
    const { isbn, isbns, site } = req.body;
    const siteId = site || DEFAULT_SITE;

    // Determine input type and create ISBN array
    let isbnArray = [];
    if (isbn && typeof isbn === 'string') {
      // Single ISBN
      isbnArray = [isbn.trim()];
    } else if (isbns && Array.isArray(isbns)) {
      // Multiple ISBNs
      isbnArray = isbns.map(i => i.trim()).filter(i => i.length > 0);
    } else {
      return res.status(400).json({ error: 'Either "isbn" (string) or "isbns" (array) is required' });
    }

    if (isbnArray.length === 0) {
      return res.status(400).json({ error: 'At least one valid ISBN is required' });
    }

    if (isbnArray.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 ISBNs allowed per request' });
    }

    const startTime = Date.now();
    const results = {};
    let scrapeSuccessful = 0;
    let aiSuccessful = 0;
    let csvSuccessful = 0;
    let failed = 0;

    // Process ISBNs sequentially to avoid overwhelming the server
    for (const isbnCode of isbnArray) {
      console.log(`Processing ISBN: ${isbnCode} from site: ${siteId}`);

      const result = await processFullWorkflow(isbnCode, siteId);
      results[isbnCode] = result;

      // Update counters
      if (result.scrapeSuccess) scrapeSuccessful++;
      if (result.aiSuccess) aiSuccessful++;
      if (result.csvSuccess) csvSuccessful++;
      if (result.error) failed++;
    }

    const totalDuration = Date.now() - startTime;

    // Normalize the response for frontend compatibility
    const normalizedResults = {};
    for (const [isbn, result] of Object.entries(results)) {
      normalizedResults[isbn] = {
        ...result,
        // Add 'found' property for frontend compatibility with regular batch scraping
        found: result.scrapeSuccess,
        // Keep original properties for enhanced full workflow display
        scrapeSuccess: result.scrapeSuccess,
        aiSuccess: result.aiSuccess,
        csvSuccess: result.csvSuccess,
        bookData: result.bookData,
        csvDuplicate: result.csvDuplicate
      };
    }

    const response = {
      results: normalizedResults,
      summary: {
        total: isbnArray.length,
        successful: scrapeSuccessful, // Add 'successful' for frontend compatibility
        scrapeSuccessful,
        aiSuccessful,
        csvSuccessful,
        failed,
        totalDuration,
        averageDuration: Math.round(totalDuration / isbnArray.length)
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Full workflow endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Get available sites endpoint
app.get('/api/sites', (req, res) => {
  try {
    res.json({
      sites: getAllSites(),
      default: DEFAULT_SITE
    });
  } catch (error) {
    console.error('Error fetching sites:', error);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

// Debug endpoint to test server
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'Server is working',
    endpoints: [
      'GET /api/sites',
      'POST /api/scrape-libraccio',
      'POST /api/scrape-libraccio-batch',
      'POST /api/full-workflow',
      'POST /api/chunked-csv-workflow',
      'GET /api/job-progress/:jobId',
      'GET /api/job-status/:jobId'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});