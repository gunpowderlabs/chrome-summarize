chrome.action.onClicked.addListener((tab) => {
  // Check if we have an API key before proceeding
  chrome.storage.sync.get(['apiKey'], function(result) {
    if (!result.apiKey) {
      // No API key, open options page
      chrome.runtime.openOptionsPage();
      // Notify the user that they need to set up the API key
      chrome.tabs.sendMessage(tab.id, { 
        action: 'displayError', 
        error: 'Please set your Anthropic API key in the extension options.'
      });
    } else {
      // API key exists, proceed with content extraction
      chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
    }
  });
});

// Listen for API requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarizeContent') {
    // Start progress tracking
    const startTime = Date.now();
    
    summarizeWithAnthropic(message.content)
      .then(summary => {
        // Send the summary back to the content script
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'displaySummary',
          summary: summary
        });
      })
      .catch(error => {
        console.error('Error:', error);
        let errorMessage = error.message || 'Error generating summary.';
        
        // Enhance error messages based on error type
        if (error.message && error.message.includes('401')) {
          errorMessage = 'Invalid API key. Please check your Anthropic API key in the extension settings.';
        } else if (error.message && error.message.includes('429')) {
          errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
        } else if (error.message && error.message.includes('500')) {
          errorMessage = 'Anthropic API is experiencing issues. Please try again later.';
        } else if (error.message && error.message.includes('network')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        }
        
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'displayError',
          error: errorMessage
        });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  }
});

// Function to call Anthropic API
async function summarizeWithAnthropic(content) {
  // Get the API key from storage
  const result = await chrome.storage.sync.get(['apiKey']);
  if (!result.apiKey) {
    throw new Error('API key not set. Please set it in the extension options.');
  }
  
  // Get the prompt template
  const promptTemplate = await fetch(chrome.runtime.getURL('prompt.txt'))
    .then(response => response.text())
    .catch(() => 'You are a helpful AI assistant that creates concise summaries of web page content.');
  
  // Limit content length to avoid excessive token usage
  const truncatedContent = content.slice(0, 100000);
  
  // Make the API request
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': result.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      temperature: 0.7,
      system: promptTemplate,
      messages: [
        { role: 'user', content: truncatedContent }
      ]
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.content[0].text;
}
