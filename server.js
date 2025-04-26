const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic client with the correct API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Read the prompt template
let promptTemplate = 'Summarize the following content';
try {
  promptTemplate = fs.readFileSync(path.join(__dirname, 'prompt.txt'), 'utf8');
} catch (error) {
  console.warn('Warning: prompt.txt not found, using default prompt');
}

// Endpoint to summarize content
app.post('/summarize', async (req, res) => {
  try {
    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('API key not found. Please set ANTHROPIC_API_KEY in .env file');
      return res.status(500).json({ error: 'API key not configured. Please set up your .env file.' });
    }

    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'No content provided' });
    }

    // Limit content length to avoid excessive token usage
    const truncatedContent = content.slice(0, 100000);
    
    // Use the messages API with Claude 3.7 Sonnet
    const message = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1000,
      temperature: 0.7,
      system: promptTemplate,
      messages: [
        { role: 'user', content: truncatedContent }
      ],
    });

    // Send summary back to the extension
    res.json({ summary: message.content[0].text });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: `Failed to generate summary: ${error.message}` });
  }
});

// Add a debug route to check API key
app.get('/debug', (req, res) => {
  // Don't show full API key, just first few chars
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'Not set';
  const sdk = require('@anthropic-ai/sdk/package.json');
  
  res.json({
    api_key_set: !!process.env.ANTHROPIC_API_KEY,
    api_key_preview: maskedKey,
    sdk_version: sdk.version,
    prompt_template_length: promptTemplate.length,
    environment: process.env.NODE_ENV
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API key set: ${process.env.ANTHROPIC_API_KEY ? 'Yes' : 'No'}`);
  console.log('Visit http://localhost:3000/debug to check configuration');
});