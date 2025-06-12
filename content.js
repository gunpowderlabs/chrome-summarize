// Create sidebar when extension is clicked
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
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
    sendResponse({ status: 'content extracted' });
    return true; // Keep the message channel open for the async response
  } else if (message.action === 'displaySummary') {
    retryCount = 0; // Reset retry count on successful summary
    displaySummary(message.summary);
    sendResponse({ status: 'summary displayed' });
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
  }
  return true; // Keep the message channel open
});

// Extract main content from the page
function extractMainContent() {
  // More comprehensive content extraction logic
  
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
function createOrUpdateSidebar(content) {
  let sidebar = document.getElementById('claude-summary-sidebar');
  
  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      document.body.removeChild(sidebar);
    };
    
    // Inject CSS if not already present
    if (!document.getElementById('claude-summary-styles')) {
      const styleSheet = document.createElement('link');
      styleSheet.id = 'claude-summary-styles';
      styleSheet.rel = 'stylesheet';
      styleSheet.href = chrome.runtime.getURL('sidebar.css');
      document.head.appendChild(styleSheet);
    }
    
    sidebar.appendChild(closeButton);
    document.body.appendChild(sidebar);
  }
  
  // Process markdown-style bold formatting
  const processedContent = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Update content
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = `<h2>Page Summary</h2><div>${processedContent}</div>`;
  
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
      const summaryText = content.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove markdown formatting
      const snippet = `${url}\n\nTL;DR: ${summaryText}`;
      
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
  
  contentDiv.appendChild(document.createElement('br'));
  contentDiv.appendChild(copyButton);
  
  // Clear previous content (except close button)
  while (sidebar.childNodes.length > 1) {
    sidebar.removeChild(sidebar.lastChild);
  }
  
  sidebar.appendChild(contentDiv);
}

// Show progress state with spinner and progress bar
function showProgressState(stage, message) {
  let sidebar = document.getElementById('claude-summary-sidebar');
  
  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      document.body.removeChild(sidebar);
    };
    
    // Inject CSS if not already present
    if (!document.getElementById('claude-summary-styles')) {
      const styleSheet = document.createElement('link');
      styleSheet.id = 'claude-summary-styles';
      styleSheet.rel = 'stylesheet';
      styleSheet.href = chrome.runtime.getURL('sidebar.css');
      document.head.appendChild(styleSheet);
    }
    
    sidebar.appendChild(closeButton);
    document.body.appendChild(sidebar);
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
  let sidebar = document.getElementById('claude-summary-sidebar');
  
  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.id = 'claude-summary-close';
    closeButton.innerText = '×';
    closeButton.onclick = () => {
      document.body.removeChild(sidebar);
    };
    
    // Inject CSS if not already present
    if (!document.getElementById('claude-summary-styles')) {
      const styleSheet = document.createElement('link');
      styleSheet.id = 'claude-summary-styles';
      styleSheet.rel = 'stylesheet';
      styleSheet.href = chrome.runtime.getURL('sidebar.css');
      document.head.appendChild(styleSheet);
    }
    
    sidebar.appendChild(closeButton);
    document.body.appendChild(sidebar);
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
function displaySummary(summary) {
  createOrUpdateSidebar(summary);
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
