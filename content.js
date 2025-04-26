// Create sidebar when extension is clicked
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    const mainContent = extractMainContent();
    requestSummary(mainContent);
    // Acknowledge receipt
    sendResponse({ status: 'content extracted' });
    return true; // Keep the message channel open for the async response
  } else if (message.action === 'displaySummary') {
    displaySummary(message.summary);
    sendResponse({ status: 'summary displayed' });
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

// Send content to the server for summarization
function requestSummary(content) {
  // Show loading state in sidebar
  createOrUpdateSidebar('Generating summary...');
  
  if (!content || content.trim().length < 50) {
    displaySummary('Error: Not enough content found on this page to summarize.');
    return;
  }
  
  // Send the content to our server for summarization
  fetch('http://localhost:3000/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  })
  .then(response => {
    if (!response.ok) {
      return response.json().then(data => {
        throw new Error(data.error || `Server error: ${response.status}`);
      });
    }
    return response.json();
  })
  .then(data => {
    if (data.summary) {
      // Update sidebar with the summary
      displaySummary(data.summary);
    } else if (data.error) {
      displaySummary(`Error: ${data.error}`);
    } else {
      displaySummary('Error: Could not generate summary.');
    }
  })
  .catch(error => {
    console.error('Error:', error);
    displaySummary(`Error: ${error.message || 'Could not connect to summarization service.'}`);
  });
}

// Create or update the sidebar
function createOrUpdateSidebar(content) {
  let sidebar = document.getElementById('claude-summary-sidebar');
  
  if (!sidebar) {
    // Create sidebar if it doesn't exist
    sidebar = document.createElement('div');
    sidebar.id = 'claude-summary-sidebar';
    sidebar.style.position = 'fixed';
    sidebar.style.top = '0';
    sidebar.style.right = '0';
    sidebar.style.width = '300px';
    sidebar.style.height = '100vh';
    sidebar.style.backgroundColor = '#fff';
    sidebar.style.boxShadow = '-2px 0 5px rgba(0,0,0,0.2)';
    sidebar.style.zIndex = '9999';
    sidebar.style.padding = '20px';
    sidebar.style.overflow = 'auto';
    sidebar.style.transition = 'transform 0.3s ease-in-out';
    sidebar.style.fontFamily = 'Arial, sans-serif';
    sidebar.style.lineHeight = '1.6';
    sidebar.style.fontSize = '14px';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerText = '×';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.border = 'none';
    closeButton.style.background = 'none';
    closeButton.style.fontSize = '20px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.color = '#333';
    closeButton.onclick = () => {
      document.body.removeChild(sidebar);
    };
    
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
