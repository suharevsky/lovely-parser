const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const generatedText = response.data.candidates[0].content.parts[0].text;
    const tokenUsage = response.data.usageMetadata;

    res.json({
      response: generatedText,
      tokenUsage: tokenUsage ? {
        promptTokens: tokenUsage.promptTokenCount,
        responseTokens: tokenUsage.candidatesTokenCount,
        totalTokens: tokenUsage.totalTokenCount
      } : null
    });

  } catch (error) {
    console.error('Error calling Gemini API:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to generate content',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});