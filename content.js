// Create sidebar when extension is clicked
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    const mainContent = extractMainContent();
    // Show loading state in sidebar
    createOrUpdateSidebar('Generating summary...');
    
    if (!mainContent || mainContent.trim().length < 50) {
      displaySummary('Error: Not enough content found on this page to summarize.');
      return;
    }
    
    // Send the content to the background script for summarization
    chrome.runtime.sendMessage({
      action: 'summarizeContent',
      content: mainContent
    });
    
    // Acknowledge receipt
    sendResponse({ status: 'content extracted' });
    return true; // Keep the message channel open for the async response
  } else if (message.action === 'displaySummary') {
    displaySummary(message.summary);
    sendResponse({ status: 'summary displayed' });
  } else if (message.action === 'displayError') {
    displaySummary(`Error: ${message.error}`);
    sendResponse({ status: 'error displayed' });
  }
  return true; // Keep the message channel open
});

// Extract main content from the page
function extractMainContent() {
  // Simple content extraction logic
  // This can be improved with more sophisticated content extraction
  const article = document.querySelector('article') || 
                 document.querySelector('main') || 
                 document.querySelector('.content') || 
                 document.querySelector('#content');
  
  if (article) {
    return article.innerText;
  }
  
  // Fallback: get all paragraphs with reasonable length
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .filter(p => p.innerText.length > 50)
    .map(p => p.innerText)
    .join('\n\n');
  
  return paragraphs || document.body.innerText;
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
  
  // Clear previous content (except close button)
  while (sidebar.childNodes.length > 1) {
    sidebar.removeChild(sidebar.lastChild);
  }
  
  sidebar.appendChild(contentDiv);
}

// Display the summary in the sidebar
function displaySummary(summary) {
  createOrUpdateSidebar(summary);
}
