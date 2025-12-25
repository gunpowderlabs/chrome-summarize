// Add a ready flag to ensure the script is fully loaded
let contentScriptReady = true;
console.log('Content script loaded and ready at:', window.location.href);

// Shadow DOM host and root references
let shadowHost = null;
let shadowRoot = null;

// Get or create the shadow DOM container for the sidebar
function getOrCreateShadowRoot() {
  if (shadowRoot) return shadowRoot;

  // Create host element
  shadowHost = document.createElement('div');
  shadowHost.id = 'claude-summary-host';

  // Attach shadow root (closed mode for full isolation)
  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  // Fetch and inject styles
  fetch(chrome.runtime.getURL('sidebar.css'))
    .then(response => response.text())
    .then(css => {
      const style = document.createElement('style');
      style.textContent = css;
      shadowRoot.insertBefore(style, shadowRoot.firstChild);
    });

  document.body.appendChild(shadowHost);
  return shadowRoot;
}

// Remove the sidebar and shadow host
function removeSidebar() {
  if (shadowHost && shadowHost.parentNode) {
    shadowHost.parentNode.removeChild(shadowHost);
  }
  shadowHost = null;
  shadowRoot = null;
}

// Get the sidebar element from shadow root
function getSidebar() {
  if (!shadowRoot) return null;
  return shadowRoot.getElementById('claude-summary-sidebar');
}

// Check if the page is fully loaded
if (document.readyState === 'loading') {
  console.log('Page still loading, waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired, content script ready');
    testConnection();
  });
} else {
  console.log('Page already loaded, content script ready immediately');
  testConnection();
}

// Test connection to background script
function testConnection() {
  chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Connection test failed:', chrome.runtime.lastError);
    } else {
      console.log('Connection test successful:', response);
    }
  });
}

// Helper function to check if current page is a YouTube video
function isYouTubeVideo() {
  return window.location.hostname.includes('youtube.com') && 
         window.location.pathname === '/watch';
}

// Helper function to get YouTube video ID from URL
function getYouTubeVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Create sidebar when extension is clicked
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);
  
  if (message.action === 'extractContent') {
    console.log('Starting content extraction...');
    // Check if this is a YouTube video
    if (isYouTubeVideo()) {
      const videoId = getYouTubeVideoId();
      if (!videoId) {
        showError('Invalid YouTube URL', 'Could not extract video ID from the current URL.', [
          { text: 'Retry', action: () => location.reload() }
        ]);
        return;
      }
      
      showProgressState('extracting', 'Preparing YouTube video for summarization...');
      
      setTimeout(() => {
        showProgressState('processing', 'Sending video to YTS tool for transcription...');
        
        // Send YouTube-specific request to background script
        chrome.runtime.sendMessage({
          action: 'summarizeYouTubeVideo',
          videoUrl: window.location.href,
          videoId: videoId,
          title: document.title
        });
      }, 300);
      
      sendResponse({ status: 'youtube video detected' });
      return true;
    }
    
    // Original content extraction for non-YouTube pages
    showProgressState('extracting', 'Extracting page content...');
    
    setTimeout(() => {
      const mainContent = extractMainContent();
      
      if (!mainContent || mainContent.trim().length < 30) {
        showError('Insufficient Content', 'Not enough content found on this page to summarize.', [
          { text: 'Try Different Page', action: () => window.location.reload() },
          { text: 'Report Issue', action: () => window.open('https://github.com/anthropics/claude-code/issues') }
        ]);
        return;
      }
      
      showProgressState('processing', 'Preparing content for AI processing...');
      
      setTimeout(() => {
        showProgressState('generating', 'Generating summary with Claude AI...');
        
        // Send the content to the background script for summarization
        chrome.runtime.sendMessage({
          action: 'summarizeContent',
          content: mainContent
        });
      }, 500);
    }, 300);
    
    // Acknowledge receipt
    console.log('Sending response back to background script');
    sendResponse({ status: 'content extracted' });
    return true; // Keep the message channel open for the async response
  } else if (message.action === 'displaySummary') {
    retryCount = 0; // Reset retry count on successful summary
    displaySummary(message.summary, message.model);
    sendResponse({ status: 'summary displayed' });
  } else if (message.action === 'displayYouTubeSummary') {
    retryCount = 0; // Reset retry count on successful summary
    displayYouTubeSummary(message.summary, message.metadata);
    sendResponse({ status: 'youtube summary displayed' });
  } else if (message.action === 'displayError') {
    const errorMessage = message.error || 'An unknown error occurred.';
    if (errorMessage.includes('API key')) {
      showError('API Key Issue', errorMessage, [
        { text: 'Open Settings', action: () => chrome.runtime.openOptionsPage() },
        { text: 'Retry', action: () => retryWithDelay() }
      ]);
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      showError('Rate Limit Exceeded', errorMessage, [
        { text: 'Retry in 1 minute', action: () => setTimeout(() => location.reload(), 60000) },
        { text: 'Check Usage', action: () => window.open('https://console.anthropic.com/account/billing') }
      ]);
    } else {
      showError('Processing Error', errorMessage, [
        { text: 'Retry', action: () => retryWithDelay() },
        { text: 'Report Issue', action: () => window.open('https://github.com/anthropics/claude-code/issues') }
      ]);
    }
    sendResponse({ status: 'error displayed' });
  } else if (message.action === 'readwiseSaveSuccess') {
    showReadwiseSuccess(message.result);
    sendResponse({ status: 'readwise save success displayed' });
  } else if (message.action === 'readwiseSaveError') {
    showReadwiseError(message.error);
    sendResponse({ status: 'readwise save error displayed' });
  } else if (message.action === 'readwiseTagsReceived') {
    handleReadwiseTagsReceived(message.tags);
    sendResponse({ status: 'readwise tags received' });
  } else if (message.action === 'readwiseTagsError') {
    showReadwiseError(message.error);
    sendResponse({ status: 'readwise tags error displayed' });
  }
  return true; // Keep the message channel open
});

// Extract main content from the page
function extractMainContent() {
  // More comprehensive content extraction logic

  // LinkedIn-specific extraction (must come before generic article selector)
  if (window.location.hostname.includes('linkedin.com')) {
    // Use role="article" to find the post container (more stable than class selectors)
    const linkedInArticle = document.querySelector('[role="article"]');

    if (linkedInArticle) {
      // Look for the post description within the article
      const postDescription = linkedInArticle.querySelector('[class*="feed-shared-update-v2__description"]') ||
                             linkedInArticle.querySelector('[class*="feed-shared-inline-show-more-text"]');

      if (postDescription && postDescription.innerText.trim().length > 50) {
        console.log('LinkedIn post content extracted:', postDescription.innerText.length, 'characters');
        return postDescription.innerText;
      }
    }
  }

  // Try common content container elements first
  const article = document.querySelector('article') ||
                 document.querySelector('main') ||
                 document.querySelector('.content') ||
                 document.querySelector('#content') ||
                 document.querySelector('.article') ||
                 document.querySelector('.post') ||
                 document.querySelector('.entry') ||
                 document.querySelector('[role="main"]');

  if (article && article.innerText.trim().length > 50) {
    return article.innerText;
  }
  
  // Try to find the text-richest div that's not too small
  const contentDivs = Array.from(document.querySelectorAll('div'))
    .filter(div => {
      const text = div.innerText || '';
      return text.length > 200 && div.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0;
    })
    .sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
  
  if (contentDivs.length > 0) {
    return contentDivs[0].innerText;
  }
  
  // Fallback: get all paragraphs with reasonable length
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .filter(p => (p.innerText || '').length > 30)
    .map(p => p.innerText)
    .join('\n\n');
  
  if (paragraphs && paragraphs.length > 100) {
    return paragraphs;
  }
  
  // Last resort: use body text but try to filter out navigation and UI elements
  const bodyText = document.body.innerText;
  if (bodyText && bodyText.length > 200) {
    return bodyText;
  }
  
  return '';
}

// Create or update the sidebar
function createOrUpdateSidebar(content, model) {
  const root = getOrCreateShadowRoot();
  let sidebar = root.getElementById('claude-summary-sidebar');

  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      removeSidebar();
    };

    sidebar.appendChild(closeButton);
    root.appendChild(sidebar);
  }
  
  // Parse summary and tags
  const parts = content.split('\nTAGS:');
  let summaryText = parts[0];
  let suggestedTags = [];
  
  if (parts.length > 1) {
    suggestedTags = parts[1].split(',').map(tag => tag.trim()).filter(tag => tag);
  }
  
  // Process markdown-style bold formatting
  const processedContent = summaryText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Update content
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = `<h2>Page Summary</h2><div>${processedContent}</div>`;
  
  // Add suggested tags display if available (only show if Readwise is not enabled)
  chrome.storage.sync.get(['enableReadwise', 'readwiseToken'], function(result) {
    if (suggestedTags.length > 0 && (!result.enableReadwise || !result.readwiseToken)) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'claude-suggested-tags';
      tagsDiv.innerHTML = `<div style="margin-top: 10px; font-size: 12px; color: #666;"><strong>Suggested tags:</strong> ${suggestedTags.join(', ')}</div>`;
      contentDiv.appendChild(tagsDiv);
    }
  });
  
  // Add "Copy Sharable Snippet" button
  const copyButton = document.createElement('button');
  copyButton.id = 'claude-summary-copy';
  copyButton.innerText = 'Copy Sharable Snippet';
  
  // Check if this is an error message
  const isError = content.startsWith('Error:');
  
  if (isError) {
    // If it's an error, copy just the URL
    copyButton.onclick = () => {
      const url = window.location.href;
      
      navigator.clipboard.writeText(url)
        .then(() => {
          // Show temporary success message
          const originalText = copyButton.innerText;
          copyButton.innerText = 'URL Copied!';
          setTimeout(() => {
            copyButton.innerText = originalText;
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy text: ', err);
          copyButton.innerText = 'Copy failed';
          setTimeout(() => {
            copyButton.innerText = 'Copy Sharable Snippet';
          }, 2000);
        });
    };
  } else {
    // Normal behavior - copy URL and summary
    copyButton.onclick = () => {
      const url = window.location.href;
      const summaryTextForCopy = summaryText.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove markdown formatting
      const snippet = `${url}\n\nTL;DR: ${summaryTextForCopy}`;
      
      navigator.clipboard.writeText(snippet)
        .then(() => {
          // Show temporary success message
          const originalText = copyButton.innerText;
          copyButton.innerText = 'Copied!';
          setTimeout(() => {
            copyButton.innerText = originalText;
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy text: ', err);
          copyButton.innerText = 'Copy failed';
          setTimeout(() => {
            copyButton.innerText = 'Copy Sharable Snippet';
          }, 2000);
        });
    };
  }
  
  // Create Readwise button
  const readwiseButton = document.createElement('button');
  readwiseButton.id = 'claude-summary-readwise';
  readwiseButton.innerText = 'Save to Readwise';
  readwiseButton.style.marginLeft = '10px';
  readwiseButton.style.backgroundColor = '#2563eb';
  readwiseButton.onclick = () => {
    showReadwiseUI(summaryText, suggestedTags, contentDiv);
  };
  
  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.marginTop = '10px';
  buttonContainer.appendChild(copyButton);
  
  // Only add Readwise button if it's not an error
  if (!isError) {
    buttonContainer.appendChild(readwiseButton);
  }
  
  contentDiv.appendChild(buttonContainer);

  // Add model info at the bottom if available
  if (model) {
    const modelDiv = document.createElement('div');
    modelDiv.className = 'claude-model-info';
    modelDiv.textContent = `Model: ${model}`;
    contentDiv.appendChild(modelDiv);
  }

  // Clear previous content (except close button)
  while (sidebar.childNodes.length > 1) {
    sidebar.removeChild(sidebar.lastChild);
  }

  sidebar.appendChild(contentDiv);
}

// Show progress state with spinner and progress bar
function showProgressState(stage, message) {
  const root = getOrCreateShadowRoot();
  let sidebar = root.getElementById('claude-summary-sidebar');

  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      removeSidebar();
    };

    sidebar.appendChild(closeButton);
    root.appendChild(sidebar);
  }
  
  // Create loading content
  const loadingContainer = document.createElement('div');
  loadingContainer.className = 'claude-loading-container';
  
  const spinner = document.createElement('div');
  spinner.className = 'claude-spinner';
  
  const progressText = document.createElement('div');
  progressText.className = 'claude-progress-text';
  progressText.textContent = message;
  
  const progressDetail = document.createElement('div');
  progressDetail.className = 'claude-progress-detail';
  
  // Set stage-specific details and progress
  let progressPercent = 0;
  switch (stage) {
    case 'extracting':
      progressPercent = 25;
      progressDetail.textContent = 'Analyzing page structure...';
      break;
    case 'processing':
      progressPercent = 50;
      progressDetail.textContent = 'Optimizing content for AI...';
      break;
    case 'generating':
      progressPercent = 75;
      progressDetail.textContent = 'Claude is reading and summarizing...';
      break;
    case 'retrying':
      progressPercent = 25;
      progressDetail.textContent = 'Preparing to retry...';
      break;
  }
  
  // Create progress bar
  const progressBarContainer = document.createElement('div');
  progressBarContainer.className = 'claude-progress-bar-container';
  
  const progressBar = document.createElement('div');
  progressBar.className = 'claude-progress-bar';
  progressBar.style.width = `${progressPercent}%`;
  
  progressBarContainer.appendChild(progressBar);
  
  loadingContainer.appendChild(spinner);
  loadingContainer.appendChild(progressText);
  loadingContainer.appendChild(progressDetail);
  loadingContainer.appendChild(progressBarContainer);
  
  // Clear previous content (except close button)
  while (sidebar.childNodes.length > 1) {
    sidebar.removeChild(sidebar.lastChild);
  }
  
  sidebar.appendChild(loadingContainer);
}

// Show error with enhanced UI and action buttons
function showError(title, message, actions = []) {
  const root = getOrCreateShadowRoot();
  let sidebar = root.getElementById('claude-summary-sidebar');

  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      removeSidebar();
    };

    sidebar.appendChild(closeButton);
    root.appendChild(sidebar);
  }
  
  // Create error content
  const errorContainer = document.createElement('div');
  errorContainer.className = 'claude-error-container';
  
  const errorTitle = document.createElement('div');
  errorTitle.className = 'claude-error-title';
  errorTitle.textContent = title;
  
  const errorMessage = document.createElement('div');
  errorMessage.className = 'claude-error-message';
  errorMessage.textContent = message;
  
  const errorActions = document.createElement('div');
  errorActions.className = 'claude-error-actions';
  
  // Add action buttons
  actions.forEach((actionConfig, index) => {
    const button = document.createElement('button');
    button.className = `claude-error-button ${index > 0 ? 'secondary' : ''}`;
    button.textContent = actionConfig.text;
    button.onclick = actionConfig.action;
    errorActions.appendChild(button);
  });
  
  errorContainer.appendChild(errorTitle);
  errorContainer.appendChild(errorMessage);
  if (actions.length > 0) {
    errorContainer.appendChild(errorActions);
  }
  
  // Clear previous content (except close button)
  while (sidebar.childNodes.length > 1) {
    sidebar.removeChild(sidebar.lastChild);
  }
  
  sidebar.appendChild(errorContainer);
}

// Display the summary in the sidebar
function displaySummary(summary, model) {
  createOrUpdateSidebar(summary, model);
}

// Display YouTube-specific summary with metadata
function displayYouTubeSummary(summary, metadata) {
  // Format the summary with additional YouTube metadata
  let enhancedSummary = summary;
  
  if (metadata) {
    const metadataSection = [];
    if (metadata.duration) {
      metadataSection.push(`**Duration:** ${metadata.duration}`);
    }
    if (metadata.channel) {
      metadataSection.push(`**Channel:** ${metadata.channel}`);
    }
    if (metadata.hasTranscript) {
      metadataSection.push(`**Source:** Video transcript`);
    }
    
    if (metadataSection.length > 0) {
      enhancedSummary = summary + '\n\n' + metadataSection.join('\n');
    }
  }
  
  createOrUpdateSidebar(enhancedSummary);
}

// Retry functionality with exponential backoff
let retryCount = 0;
const maxRetries = 3;

function retryWithDelay() {
  if (retryCount >= maxRetries) {
    showError('Maximum Retries Exceeded', 'Please check your connection and try again later.', [
      { text: 'Reset', action: () => { retryCount = 0; chrome.runtime.sendMessage({ action: 'extractContent' }); } }
    ]);
    return;
  }
  
  retryCount++;
  const delay = Math.pow(2, retryCount - 1) * 1000; // 1s, 2s, 4s
  
  showProgressState('retrying', `Retrying in ${delay / 1000} seconds... (${retryCount}/${maxRetries})`);
  
  setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'extractContent' });
  }, delay);
}

// Global variables for Readwise functionality
let currentReadwiseTags = [];
let currentSummaryForSave = '';
let currentSuggestedTags = [];
let currentContentDiv = null;

// Show Readwise UI inline below the button
function showReadwiseUI(summary, suggestedTags, contentDiv) {
  currentSummaryForSave = summary;
  currentSuggestedTags = suggestedTags || [];
  currentContentDiv = contentDiv;
  
  // Check if Readwise is enabled
  chrome.storage.sync.get(['enableReadwise', 'readwiseToken'], function(result) {
    if (!result.enableReadwise || !result.readwiseToken) {
      showError('Readwise Not Configured', 'Please enable Readwise integration and set your API token in the extension settings.', [
        { text: 'Open Settings', action: () => chrome.runtime.openOptionsPage() }
      ]);
      return;
    }
    
    // Show loading state in inline UI
    showReadwiseLoadingState();
    
    // Get existing Readwise tags
    chrome.runtime.sendMessage({ action: 'getReadwiseTags' });
  });
}

// Show loading state for Readwise
function showReadwiseLoadingState() {
  if (!currentContentDiv) return;
  
  // Remove existing Readwise UI if present
  const existingReadwiseUI = currentContentDiv.querySelector('.claude-readwise-inline');
  if (existingReadwiseUI) {
    existingReadwiseUI.remove();
  }
  
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'claude-readwise-inline';
  loadingDiv.innerHTML = `
    <div style="margin-top: 15px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px; background-color: #f9fafb;">
      <div style="font-size: 12px; color: #666; margin-bottom: 5px;">Loading your Readwise tags...</div>
    </div>
  `;
  
  currentContentDiv.appendChild(loadingDiv);
}

// Handle received Readwise tags
function handleReadwiseTagsReceived(tags) {
  currentReadwiseTags = tags;
  displayReadwiseInlineUI();
}

// Display the Readwise tag selection UI inline
function displayReadwiseInlineUI() {
  if (!currentContentDiv) return;
  
  // Remove existing Readwise UI if present
  const existingReadwiseUI = currentContentDiv.querySelector('.claude-readwise-inline');
  if (existingReadwiseUI) {
    existingReadwiseUI.remove();
  }
  
  // Create inline UI container
  const readwiseContainer = document.createElement('div');
  readwiseContainer.className = 'claude-readwise-inline';
  readwiseContainer.style.marginTop = '15px';
  readwiseContainer.style.padding = '15px';
  readwiseContainer.style.border = '1px solid #e5e7eb';
  readwiseContainer.style.borderRadius = '6px';
  readwiseContainer.style.backgroundColor = '#f9fafb';
  
  const title = document.createElement('div');
  title.innerHTML = '<strong>Save to Readwise</strong>';
  title.style.marginBottom = '10px';
  title.style.fontSize = '14px';
  
  // Combined tags section - show suggested tags first (pre-selected), then remaining tags
  if (currentReadwiseTags.length > 0) {
    const tagsSection = document.createElement('div');
    tagsSection.innerHTML = '<div style="margin-bottom: 8px; font-size: 12px; color: #666;"><strong>Select tags:</strong></div>';
    
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'claude-tags-container';
    tagsContainer.style.maxHeight = '120px';
    tagsContainer.style.overflowY = 'auto';
    tagsContainer.style.marginBottom = '10px';
    
    // First add suggested tags (pre-selected)
    currentSuggestedTags.forEach(suggestedTag => {
      const matchingTag = currentReadwiseTags.find(tag => tag.name === suggestedTag);
      if (matchingTag) {
        const tagButton = document.createElement('button');
        tagButton.className = 'claude-tag-button suggested selected';
        tagButton.textContent = matchingTag.name;
        tagButton.style.backgroundColor = '#2563eb';
        tagButton.style.color = 'white';
        tagButton.onclick = () => toggleTagSelection(tagButton, matchingTag.name);
        tagsContainer.appendChild(tagButton);
      }
    });
    
    // Then add remaining tags (not suggested)
    currentReadwiseTags.forEach(tag => {
      if (!currentSuggestedTags.includes(tag.name)) {
        const tagButton = document.createElement('button');
        tagButton.className = 'claude-tag-button';
        tagButton.textContent = tag.name;
        tagButton.onclick = () => toggleTagSelection(tagButton, tag.name);
        tagsContainer.appendChild(tagButton);
      }
    });
    
    tagsSection.appendChild(tagsContainer);
    readwiseContainer.appendChild(tagsSection);
  }
  
  // Action buttons
  const actionButtons = document.createElement('div');
  actionButtons.style.display = 'flex';
  actionButtons.style.gap = '8px';
  actionButtons.style.marginTop = '10px';
  
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save to Readwise';
  saveButton.style.padding = '6px 12px';
  saveButton.style.backgroundColor = '#2563eb';
  saveButton.style.color = 'white';
  saveButton.style.border = 'none';
  saveButton.style.borderRadius = '4px';
  saveButton.style.cursor = 'pointer';
  saveButton.style.fontSize = '12px';
  saveButton.onclick = saveToReadwise;
  
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.padding = '6px 12px';
  cancelButton.style.backgroundColor = '#6c757d';
  cancelButton.style.color = 'white';
  cancelButton.style.border = 'none';
  cancelButton.style.borderRadius = '4px';
  cancelButton.style.cursor = 'pointer';
  cancelButton.style.fontSize = '12px';
  cancelButton.onclick = () => {
    readwiseContainer.remove();
  };
  
  actionButtons.appendChild(saveButton);
  actionButtons.appendChild(cancelButton);
  
  readwiseContainer.appendChild(title);
  readwiseContainer.appendChild(actionButtons);
  
  currentContentDiv.appendChild(readwiseContainer);
}

// Toggle tag selection
function toggleTagSelection(button, tagName) {
  if (button.classList.contains('selected')) {
    button.classList.remove('selected');
    button.style.backgroundColor = '';
    button.style.color = '';
  } else {
    button.classList.add('selected');
    button.style.backgroundColor = '#2563eb';
    button.style.color = 'white';
  }
}

// Save to Readwise with selected tags
function saveToReadwise() {
  const root = getOrCreateShadowRoot();
  const selectedTags = Array.from(root.querySelectorAll('.claude-tag-button.selected'))
    .map(button => button.textContent);
  
  const url = window.location.href;
  const title = document.title;
  
  // Show saving state in inline UI
  showReadwiseSavingState();
  
  chrome.runtime.sendMessage({
    action: 'saveToReadwise',
    url: url,
    title: title,
    summary: currentSummaryForSave.replace(/\*\*(.*?)\*\*/g, '$1'), // Remove markdown formatting
    tags: selectedTags
  });
}

// Show saving state for Readwise
function showReadwiseSavingState() {
  if (!currentContentDiv) return;
  
  const existingReadwiseUI = currentContentDiv.querySelector('.claude-readwise-inline');
  if (existingReadwiseUI) {
    existingReadwiseUI.innerHTML = `
      <div style="padding: 15px; text-align: center;">
        <div style="font-size: 14px; color: #666; margin-bottom: 5px;">Saving to Readwise...</div>
        <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2563eb; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
      </div>
    `;
  }
}

// Show Readwise success message
function showReadwiseSuccess(result) {
  if (!currentContentDiv) return;
  
  const existingReadwiseUI = currentContentDiv.querySelector('.claude-readwise-inline');
  if (existingReadwiseUI) {
    existingReadwiseUI.innerHTML = `
      <div style="padding: 15px; text-align: center;">
        <div style="font-size: 14px; color: #22c55e; margin-bottom: 10px;">✓ Saved to Readwise!</div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button onclick="window.open('https://read.readwise.io/new')" style="padding: 6px 12px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">View in Readwise</button>
          <button onclick="this.closest('.claude-readwise-inline').remove()" style="padding: 6px 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Close</button>
        </div>
      </div>
    `;
  }
}

// Show Readwise error message
function showReadwiseError(error) {
  if (!currentContentDiv) return;
  
  const existingReadwiseUI = currentContentDiv.querySelector('.claude-readwise-inline');
  if (existingReadwiseUI) {
    existingReadwiseUI.innerHTML = `
      <div style="padding: 15px;">
        <div style="font-size: 14px; color: #dc2626; margin-bottom: 10px;">✗ Error: ${error}</div>
        <div style="display: flex; gap: 8px;">
          <button onclick="chrome.runtime.openOptionsPage()" style="padding: 6px 12px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Open Settings</button>
          <button onclick="saveToReadwise()" style="padding: 6px 12px; background-color: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Retry</button>
          <button onclick="this.closest('.claude-readwise-inline').remove()" style="padding: 6px 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Cancel</button>
        </div>
      </div>
    `;
  }
}
