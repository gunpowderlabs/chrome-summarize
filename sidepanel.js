// Current tab state
let currentTabId = null;
let currentState = null;

// Readwise state
let currentReadwiseTags = [];
let currentSuggestedTags = [];

// Retry state
let retryCount = 0;
const maxRetries = 3;

// DOM references
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const summaryState = document.getElementById('summary-state');
const progressText = document.getElementById('progress-text');
const progressDetail = document.getElementById('progress-detail');
const progressBar = document.getElementById('progress-bar');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const errorActions = document.getElementById('error-actions');
const summaryContent = document.getElementById('summary-content');
const suggestedTagsDisplay = document.getElementById('suggested-tags-display');
const buttonContainer = document.getElementById('button-container');
const copyButton = document.getElementById('copy-button');
const readwiseButton = document.getElementById('readwise-button');
const readwiseInlineUI = document.getElementById('readwise-inline-ui');
const modelInfo = document.getElementById('model-info');

// HTML escaping to prevent XSS
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// On panel load, ask background for current state
chrome.runtime.sendMessage({ action: 'panelReady' }, (response) => {
  if (chrome.runtime.lastError) {
    // Background not ready yet
    return;
  }
  if (response) {
    currentTabId = response.tabId;
    renderState(response.state);
  }
});

// Listen for state updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stateUpdate') {
    if (message.tabId === currentTabId) {
      renderState(message.state);
    }
    sendResponse({ status: 'ok' });
  } else if (message.action === 'activeTabChanged') {
    currentTabId = message.tabId;
    renderState(message.state);
    sendResponse({ status: 'ok' });
  } else if (message.action === 'readwiseTagsReceived') {
    currentReadwiseTags = message.tags;
    displayReadwiseTagUI();
    sendResponse({ status: 'ok' });
  } else if (message.action === 'readwiseSaveSuccess') {
    showReadwiseSuccess();
    sendResponse({ status: 'ok' });
  } else if (message.action === 'readwiseSaveError') {
    showReadwiseError(message.error);
    sendResponse({ status: 'ok' });
  } else if (message.action === 'readwiseTagsError') {
    showReadwiseError(message.error);
    sendResponse({ status: 'ok' });
  }
  return true;
});

// Copy button handler
copyButton.addEventListener('click', () => {
  if (!currentState) return;

  const url = currentState.url || '';
  const summary = currentState.summary || '';
  const isError = currentState.phase === 'error';

  let textToCopy;
  if (isError) {
    textToCopy = url;
  } else {
    const cleanSummary = summary.split('\nTAGS:')[0].replace(/\*\*(.*?)\*\*/g, '$1');
    textToCopy = `${url}\n\nTL;DR: ${cleanSummary}`;
  }

  navigator.clipboard.writeText(textToCopy)
    .then(() => {
      const originalText = copyButton.textContent;
      copyButton.textContent = isError ? 'URL Copied!' : 'Copied!';
      setTimeout(() => { copyButton.textContent = originalText; }, 2000);
    })
    .catch(() => {
      copyButton.textContent = 'Copy failed';
      setTimeout(() => { copyButton.textContent = 'Copy Sharable Snippet'; }, 2000);
    });
});

// Readwise button handler
readwiseButton.addEventListener('click', () => {
  if (!currentState) return;
  showReadwiseUI();
});

// --- State Rendering ---

function hideAllStates() {
  emptyState.classList.remove('active');
  loadingState.classList.remove('active');
  errorState.classList.remove('active');
  summaryState.classList.remove('active');
}

function renderState(state) {
  if (!state) {
    state = { phase: 'empty' };
  }
  currentState = state;
  hideAllStates();

  switch (state.phase) {
    case 'empty':
      emptyState.classList.add('active');
      break;
    case 'progress':
      renderProgressState(state.stage, state.message);
      break;
    case 'error':
      renderError(state.title, state.message, state.errorType);
      break;
    case 'summary':
      renderSummary(state.summary, state.model, state.metadata);
      break;
    default:
      emptyState.classList.add('active');
  }
}

function renderProgressState(stage, message) {
  loadingState.classList.add('active');

  progressText.textContent = message || 'Processing...';

  let percent = 0;
  let detail = '';
  switch (stage) {
    case 'extracting':
      percent = 25;
      detail = 'Analyzing page structure...';
      break;
    case 'processing':
      percent = 50;
      detail = 'Optimizing content for AI...';
      break;
    case 'generating':
      percent = 75;
      detail = 'Claude is reading and summarizing...';
      break;
    case 'retrying':
      percent = 25;
      detail = 'Preparing to retry...';
      break;
  }

  progressDetail.textContent = detail;
  progressBar.style.width = `${percent}%`;
}

function renderError(title, message, errorType) {
  errorState.classList.add('active');

  errorTitle.textContent = title || 'Error';
  errorMessage.textContent = message || 'An unknown error occurred.';

  // Clear previous action buttons
  errorActions.innerHTML = '';

  const actions = getErrorActions(errorType);
  actions.forEach((actionConfig, index) => {
    const button = document.createElement('button');
    button.className = `claude-error-button ${index > 0 ? 'secondary' : ''}`;
    button.textContent = actionConfig.text;
    button.addEventListener('click', actionConfig.action);
    errorActions.appendChild(button);
  });
}

function getErrorActions(errorType) {
  switch (errorType) {
    case 'apiKey':
      return [
        { text: 'Open Settings', action: () => chrome.runtime.openOptionsPage() },
        { text: 'Retry', action: () => requestRetry() }
      ];
    case 'rateLimit':
      return [
        { text: 'Retry in 1 minute', action: () => setTimeout(() => requestRetry(), 60000) },
        { text: 'Check Usage', action: () => chrome.tabs.create({ url: 'https://console.anthropic.com/account/billing' }) }
      ];
    default:
      return [
        { text: 'Retry', action: () => requestRetry() },
        { text: 'Report Issue', action: () => chrome.tabs.create({ url: 'https://github.com/anthropics/claude-code/issues' }) }
      ];
  }
}

function renderSummary(summary, model, metadata) {
  summaryState.classList.add('active');

  // Parse summary and tags
  const parts = summary.split('\nTAGS:');
  let summaryText = parts[0];
  let suggestedTags = [];

  if (parts.length > 1) {
    suggestedTags = parts[1].split(',').map(tag => tag.trim()).filter(tag => tag);
  }
  currentSuggestedTags = suggestedTags;

  // Process markdown-style formatting (escape HTML first to prevent XSS)
  let processedContent = escapeHtml(summaryText);

  // Remove markdown headers
  processedContent = processedContent.replace(/^#{1,6}\s+(.*)$/gm, '$1');

  // Convert bold formatting
  processedContent = processedContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert double newlines to paragraph breaks
  processedContent = processedContent
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p}</p>`)
    .join('');

  // Add YouTube metadata if present
  if (metadata) {
    const metaParts = [];
    if (metadata.duration) metaParts.push(`<strong>Duration:</strong> ${escapeHtml(metadata.duration)}`);
    if (metadata.channel) metaParts.push(`<strong>Channel:</strong> ${escapeHtml(metadata.channel)}`);
    if (metadata.hasTranscript) metaParts.push(`<strong>Source:</strong> Video transcript`);
    if (metaParts.length > 0) {
      processedContent += `<p>${metaParts.join('<br>')}</p>`;
    }
  }

  summaryContent.innerHTML = processedContent;

  // Show suggested tags if Readwise is not enabled
  suggestedTagsDisplay.innerHTML = '';
  chrome.storage.sync.get(['enableReadwise', 'readwiseToken'], (result) => {
    if (suggestedTags.length > 0 && (!result.enableReadwise || !result.readwiseToken)) {
      suggestedTagsDisplay.innerHTML = `<div class="claude-suggested-tags"><strong>Suggested tags:</strong> ${escapeHtml(suggestedTags.join(', '))}</div>`;
    }
  });

  // Show/hide buttons
  buttonContainer.style.display = 'flex';
  readwiseInlineUI.innerHTML = '';

  // Word count and model info
  const wordCount = summaryText.trim().split(/\s+/).filter(w => w.length > 0).length;
  modelInfo.textContent = model ? `${wordCount} words · ${model}` : `${wordCount} words`;
}

// --- Retry ---

function requestRetry() {
  if (!currentTabId) return;

  retryCount++;
  if (retryCount > maxRetries) {
    renderError('Maximum Retries Exceeded', 'Please check your connection and try again later.', 'generic');
    retryCount = 0;
    return;
  }

  const delay = Math.pow(2, retryCount - 1) * 1000;
  renderState({
    phase: 'progress',
    stage: 'retrying',
    message: `Retrying in ${delay / 1000} seconds... (${retryCount}/${maxRetries})`
  });

  setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'retrySummarize', tabId: currentTabId });
  }, delay);
}

// --- Readwise UI ---

function showReadwiseUI() {
  chrome.storage.sync.get(['enableReadwise', 'readwiseToken'], (result) => {
    if (!result.enableReadwise || !result.readwiseToken) {
      renderError('Readwise Not Configured', 'Please enable Readwise integration and set your API token in the extension settings.', 'apiKey');
      return;
    }

    // Show loading state
    readwiseInlineUI.innerHTML = '<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Loading your Readwise tags...</div>';

    // Request tags from background
    chrome.runtime.sendMessage({ action: 'getReadwiseTags' });
  });
}

function displayReadwiseTagUI() {
  readwiseInlineUI.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'claude-readwise-inline';

  const title = document.createElement('div');
  title.innerHTML = '<strong>Save to Readwise</strong>';
  title.style.marginBottom = '10px';
  title.style.fontSize = '14px';
  container.appendChild(title);

  // Tags section
  if (currentReadwiseTags.length > 0) {
    const tagsLabel = document.createElement('div');
    tagsLabel.style.cssText = 'margin-bottom: 8px; font-size: 12px; color: #666;';
    tagsLabel.innerHTML = '<strong>Select tags:</strong>';
    container.appendChild(tagsLabel);

    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'claude-tags-container';
    tagsContainer.style.maxHeight = '120px';
    tagsContainer.style.overflowY = 'auto';

    // Suggested tags first (pre-selected)
    currentSuggestedTags.forEach(suggestedTag => {
      const matchingTag = currentReadwiseTags.find(tag => tag.name === suggestedTag);
      if (matchingTag) {
        const tagButton = document.createElement('button');
        tagButton.className = 'claude-tag-button suggested selected';
        tagButton.textContent = matchingTag.name;
        tagButton.addEventListener('click', () => toggleTagSelection(tagButton));
        tagsContainer.appendChild(tagButton);
      }
    });

    // Remaining tags
    currentReadwiseTags.forEach(tag => {
      if (!currentSuggestedTags.includes(tag.name)) {
        const tagButton = document.createElement('button');
        tagButton.className = 'claude-tag-button';
        tagButton.textContent = tag.name;
        tagButton.addEventListener('click', () => toggleTagSelection(tagButton));
        tagsContainer.appendChild(tagButton);
      }
    });

    container.appendChild(tagsContainer);
  }

  // Action buttons
  const actionButtons = document.createElement('div');
  actionButtons.style.cssText = 'display: flex; gap: 8px; margin-top: 10px;';

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save to Readwise';
  saveButton.style.cssText = 'padding: 6px 12px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  saveButton.addEventListener('click', saveToReadwise);

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = 'padding: 6px 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  cancelButton.addEventListener('click', () => { readwiseInlineUI.innerHTML = ''; });

  actionButtons.appendChild(saveButton);
  actionButtons.appendChild(cancelButton);
  container.appendChild(actionButtons);

  readwiseInlineUI.appendChild(container);
}

function toggleTagSelection(button) {
  button.classList.toggle('selected');
}

function saveToReadwise() {
  const selectedTags = Array.from(readwiseInlineUI.querySelectorAll('.claude-tag-button.selected'))
    .map(button => button.textContent);

  // Show saving state
  readwiseInlineUI.innerHTML = `
    <div class="claude-readwise-inline" style="text-align: center;">
      <div style="font-size: 14px; color: #666; margin-bottom: 5px;">Saving to Readwise...</div>
      <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2563eb; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
    </div>
  `;

  const summary = (currentState.summary || '').split('\nTAGS:')[0].replace(/\*\*(.*?)\*\*/g, '$1');

  chrome.runtime.sendMessage({
    action: 'saveToReadwise',
    url: currentState.url,
    title: currentState.pageTitle,
    summary: summary,
    tags: selectedTags
  });
}

function showReadwiseSuccess() {
  readwiseInlineUI.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'claude-readwise-inline';
  container.style.textAlign = 'center';

  const successMsg = document.createElement('div');
  successMsg.style.cssText = 'font-size: 14px; color: #22c55e; margin-bottom: 10px;';
  successMsg.textContent = '\u2713 Saved to Readwise!';
  container.appendChild(successMsg);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display: flex; gap: 8px; justify-content: center;';

  const viewButton = document.createElement('button');
  viewButton.textContent = 'View in Readwise';
  viewButton.style.cssText = 'padding: 6px 12px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  viewButton.addEventListener('click', () => chrome.tabs.create({ url: 'https://read.readwise.io/new' }));

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.cssText = 'padding: 6px 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  closeButton.addEventListener('click', () => { readwiseInlineUI.innerHTML = ''; });

  buttons.appendChild(viewButton);
  buttons.appendChild(closeButton);
  container.appendChild(buttons);

  readwiseInlineUI.appendChild(container);
}

function showReadwiseError(error) {
  readwiseInlineUI.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'claude-readwise-inline';

  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = 'font-size: 14px; color: #dc2626; margin-bottom: 10px;';
  errorMsg.textContent = `\u2717 Error: ${error}`;
  container.appendChild(errorMsg);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display: flex; gap: 8px;';

  const settingsButton = document.createElement('button');
  settingsButton.textContent = 'Open Settings';
  settingsButton.style.cssText = 'padding: 6px 12px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());

  const retryButton = document.createElement('button');
  retryButton.textContent = 'Retry';
  retryButton.style.cssText = 'padding: 6px 12px; background-color: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  retryButton.addEventListener('click', saveToReadwise);

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = 'padding: 6px 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
  cancelButton.addEventListener('click', () => { readwiseInlineUI.innerHTML = ''; });

  buttons.appendChild(settingsButton);
  buttons.appendChild(retryButton);
  buttons.appendChild(cancelButton);
  container.appendChild(buttons);

  readwiseInlineUI.appendChild(container);
}
