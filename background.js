chrome.action.onClicked.addListener((tab) => {
  // Check if we have an API key before proceeding
  chrome.storage.sync.get(['apiKey'], function(result) {
    if (!result.apiKey) {
      // No API key, open options page
      chrome.runtime.openOptionsPage();
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
    
    summarizeWithAnthropic(message.content, sender.tab.id)
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
  } else if (message.action === 'summarizeYouTubeVideo') {
    // Handle YouTube video summarization using YTS tool
    summarizeYouTubeWithYTS(message.videoUrl, message.videoId, message.title, sender.tab.id)
      .then(result => {
        // Send the summary back to the content script with metadata
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'displayYouTubeSummary',
          summary: result.summary,
          metadata: result.metadata
        });
      })
      .catch(error => {
        console.error('YouTube summarization error:', error);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'displayError',
          error: `YouTube summarization failed: ${error.message}`
        });
      });
    
    return true;
  } else if (message.action === 'saveToReadwise') {
    saveToReadwise(message.url, message.title, message.summary, message.tags, sender.tab.id)
      .then(result => {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'readwiseSaveSuccess',
          result: result
        });
      })
      .catch(error => {
        console.error('Readwise save error:', error);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'readwiseSaveError',
          error: error.message
        });
      });
    return true;
  } else if (message.action === 'getReadwiseTags') {
    getReadwiseTags()
      .then(tags => {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'readwiseTagsReceived',
          tags: tags
        });
      })
      .catch(error => {
        console.error('Error fetching Readwise tags:', error);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'readwiseTagsError',
          error: error.message
        });
      });
    return true;
  }
});

// Function to call Anthropic API
async function summarizeWithAnthropic(content, tabId) {
  // Get the API key from storage
  const result = await chrome.storage.sync.get(['apiKey', 'enableReadwise', 'readwiseToken']);
  if (!result.apiKey) {
    throw new Error('API key not set. Please set it in the extension options.');
  }
  
  // Get the prompt template
  let promptTemplate = await fetch(chrome.runtime.getURL('prompt.txt'))
    .then(response => response.text())
    .catch(() => 'You are a helpful AI assistant that creates concise summaries of web page content.');
  
  // If Readwise is enabled, get user's tags and modify the prompt
  let availableTags = [];
  if (result.enableReadwise && result.readwiseToken) {
    try {
      const tags = await getReadwiseTags();
      availableTags = tags.map(tag => tag.name);
      
      if (availableTags.length > 0) {
        // Modify the prompt to include available tags
        promptTemplate = promptTemplate.replace(
          'Choose 3-5 relevant tags that would help organize this content. Use general categories like: technology, business, science, health, productivity, news, finance, education, entertainment, etc. Keep tags concise (1-2 words each).',
          `Choose 3-5 relevant tags that would help organize this content. You MUST select ONLY from these existing tags that the user already uses in Readwise: ${availableTags.join(', ')}. Do not create new tags - only suggest from this list.`
        );
      }
    } catch (error) {
      console.log('Could not fetch Readwise tags, using generic tag suggestions:', error);
      // Continue with generic tags if Readwise fetch fails
    }
  }
  
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
      model: 'claude-haiku-4-5',
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

// Function to get Readwise tags
async function getReadwiseTags() {
  const result = await chrome.storage.sync.get(['readwiseToken', 'enableReadwise']);
  
  if (!result.enableReadwise || !result.readwiseToken) {
    throw new Error('Readwise integration not enabled or token not set.');
  }
  
  const response = await fetch('https://readwise.io/api/v3/tags/', {
    method: 'GET',
    headers: {
      'Authorization': `Token ${result.readwiseToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid Readwise token. Please check your token in extension settings.');
    }
    throw new Error(`Readwise API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.results || [];
}

// Function to save article to Readwise
async function saveToReadwise(url, title, summary, tags, tabId) {
  const result = await chrome.storage.sync.get(['readwiseToken', 'enableReadwise']);
  
  if (!result.enableReadwise || !result.readwiseToken) {
    throw new Error('Readwise integration not enabled or token not set.');
  }
  
  const payload = {
    url: url,
    tags: tags || [],
    location: 'new'
  };
  
  if (title) {
    payload.title = title;
  }
  
  if (summary) {
    payload.summary = summary;
  }
  
  const response = await fetch('https://readwise.io/api/v3/save/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${result.readwiseToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid Readwise token. Please check your token in extension settings.');
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
    }
    
    const errorData = await response.json();
    throw new Error(errorData.detail || `Readwise API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data;
}

// Function to summarize YouTube videos using YTS tool via Native Messaging
async function summarizeYouTubeWithYTS(videoUrl, videoId, title, tabId) {
  return new Promise((resolve, reject) => {
    // Connect to native messaging host
    const port = chrome.runtime.connectNative('com.chrome_summarize.yts');
    
    let responseReceived = false;
    
    port.onMessage.addListener((response) => {
      responseReceived = true;
      
      if (response.success) {
        try {
          const summaryData = response.summary;
          const metadata = response.metadata;
          
          // Format the summary
          let summary = summaryData.tldr || 'No summary available';
          
          // Add suggested tags if available
          if (summaryData.tags && summaryData.tags.length > 0) {
            summary += '\nTAGS: ' + summaryData.tags.join(', ');
          }
          
          resolve({
            summary: summary,
            metadata: {
              duration: metadata.duration || 'Unknown',
              channel: metadata.uploader || 'Unknown',
              hasTranscript: true,
              fullSummary: summaryData.full_summary
            }
          });
        } catch (error) {
          reject(new Error('Failed to parse YTS response: ' + error.message));
        }
      } else {
        reject(new Error(response.error || 'YTS processing failed'));
      }
      
      port.disconnect();
    });
    
    port.onDisconnect.addListener(() => {
      if (!responseReceived) {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error('Native messaging failed: ' + error.message));
        } else {
          reject(new Error('Native messaging host disconnected unexpectedly'));
        }
      }
    });
    
    // Send the summarize request
    port.postMessage({
      action: 'summarize',
      url: videoUrl
    });
    
    // Timeout after 5 minutes (YTS can take a while for long videos)
    setTimeout(() => {
      if (!responseReceived) {
        port.disconnect();
        reject(new Error('YTS processing timed out after 5 minutes'));
      }
    }, 300000);
  });
}