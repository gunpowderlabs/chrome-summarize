// Create sidebar when extension is clicked
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    const mainContent = extractMainContent();
    // Show loading state in sidebar
    createOrUpdateSidebar('Generating summary...');
    
    if (!mainContent || mainContent.trim().length < 30) {
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
    return getCleanText(article);
  }
  
  // Try to find the text-richest div that's not too small
  const contentDivs = Array.from(document.querySelectorAll('div'))
    .filter(div => {
      const text = div.innerText || '';
      return text.length > 200 && div.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0;
    })
    .sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
  
  if (contentDivs.length > 0) {
    return getCleanText(contentDivs[0]);
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

// Display the summary in the sidebar
function displaySummary(summary) {
  createOrUpdateSidebar(summary);
}

// Remove obvious comment or feedback sections from an element and return text
function getCleanText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  const selectors = [
    '#comments', '.comments', '[id*="comment"]', '[class*="comment"]',
    '#disqus_thread', '.disqus', '[id*="reply"]', '.reply',
    '#feedback-box', '#feedback-confirmation-box'
  ];
  selectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });
  return clone.innerText.trim();
}
