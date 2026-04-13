// Per-tab state store (in-memory cache, backed by session storage)
const tabStates = new Map();
let nextRequestId = 0;

// Restore tab states from session storage (survives service worker restarts)
const stateRestored = chrome.storage.session.get('tabStates').then(({ tabStates: stored }) => {
  if (stored) {
    for (const [key, value] of Object.entries(stored)) {
      // Reset in-progress states — the summarization isn't running after a restart
      if (value.phase === 'progress') {
        value.phase = 'empty';
        delete value.requestId;
        delete value.startTime;
      }
      tabStates.set(Number(key), value);
    }
  }
});

function persistTabStates() {
  chrome.storage.session.set({ tabStates: Object.fromEntries(tabStates) });
}

function broadcastTabState(tabId, state) {
  chrome.runtime.sendMessage({
    action: 'stateUpdate',
    tabId: tabId,
    state: state
  }).catch(() => {
    // Side panel might not be open — that's fine
  });
}

function setTabState(tabId, state, { broadcast = true } = {}) {
  tabStates.set(tabId, state);
  persistTabStates();

  if (broadcast) {
    broadcastTabState(tabId, state);
  }

  return state;
}

function getTabStateSnapshot(tabId, fallbackTab = null) {
  const state = { ...(tabStates.get(tabId) || { phase: 'empty' }) };

  if (fallbackTab) {
    state.url = state.url || fallbackTab.url;
    state.pageTitle = state.pageTitle || fallbackTab.title;
  }

  return state;
}

function createLoadingState(tab = null) {
  const state = {
    phase: 'progress',
    stage: 'extracting',
    message: 'Extracting page content...',
    startTime: Date.now()
  };

  if (tab?.url) {
    state.url = tab.url;
  }

  if (tab?.title) {
    state.pageTitle = tab.title;
  }

  return state;
}

function createRequestId() {
  nextRequestId += 1;
  return `request-${nextRequestId}`;
}

function isCurrentRequest(tabId, requestId) {
  return tabStates.get(tabId)?.requestId === requestId;
}

function updateTabStateForRequest(tabId, requestId, partialState) {
  if (!isCurrentRequest(tabId, requestId)) {
    return false;
  }
  updateTabState(tabId, partialState);
  return true;
}

// Model used for summarization
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// --- State Management ---

function updateTabState(tabId, partialState) {
  const current = tabStates.get(tabId) || { phase: 'empty' };
  const newState = { ...current, ...partialState };
  return setTabState(tabId, newState);
}

// Disable side panel globally by default — only show on tabs where user explicitly opens it
chrome.sidePanel.setOptions({ enabled: false });

// --- Action Click / Keyboard Shortcut ---

chrome.action.onClicked.addListener(async (tab) => {
  // Enable side panel for this specific tab and open it
  // setOptions must not be awaited — any await before open() breaks the user gesture chain
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });

  // Pre-set tab state before opening the panel so panelReady picks up 'progress'
  // instead of 'empty' (avoids a flash of the empty state)
  const loadingState = createLoadingState(tab);
  setTabState(tab.id, loadingState, { broadcast: false });

  await chrome.sidePanel.open({ windowId: tab.windowId, tabId: tab.id });

  // If the panel was already open, it will not remount and won't see the
  // preloaded state unless we actively broadcast it here.
  updateTabState(tab.id, loadingState);

  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    // Show error in the side panel instead of opening options directly
    updateTabState(tab.id, {
      phase: 'error',
      title: 'API Key Required',
      message: 'Please set your Anthropic API key in the extension settings.',
      errorType: 'apiKey',
      url: tab.url,
      pageTitle: tab.title
    });
    return;
  }

  startSummarization(tab.id);
});

// --- Summarization Flow ---

async function startSummarization(tabId) {
  const requestId = createRequestId();
  updateTabState(tabId, {
    phase: 'progress',
    stage: 'extracting',
    message: 'Extracting page content...',
    startTime: Date.now(),
    requestId: requestId
  });

  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extractContent' });
    handleExtractedContent(tabId, response, requestId);
  } catch (err) {
    // Content script not loaded — inject it and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      const response = await chrome.tabs.sendMessage(tabId, { action: 'extractContent' });
      handleExtractedContent(tabId, response, requestId);
    } catch (err2) {
      updateTabStateForRequest(tabId, requestId, {
        phase: 'error',
        title: 'Cannot Access Page',
        message: 'Unable to extract content from this page. It may be a browser internal page.',
        errorType: 'generic'
      });
    }
  }
}

function handleExtractedContent(tabId, response, requestId) {
  if (!isCurrentRequest(tabId, requestId)) {
    return;
  }

  if (!response) {
    updateTabStateForRequest(tabId, requestId, {
      phase: 'error',
      title: 'Extraction Failed',
      message: 'No response from content script.',
      errorType: 'generic'
    });
    return;
  }

  // Store URL and title
  if (!updateTabStateForRequest(tabId, requestId, { url: response.url, pageTitle: response.title })) {
    return;
  }

  if (response.isYouTube) {
    if (!response.videoId) {
      updateTabStateForRequest(tabId, requestId, {
        phase: 'error',
        title: 'Invalid YouTube URL',
        message: 'Could not extract video ID from the current URL.',
        errorType: 'generic'
      });
      return;
    }

    if (!updateTabStateForRequest(tabId, requestId, {
      phase: 'progress',
      stage: 'processing',
      message: 'Sending video to YTS tool for transcription...'
    })) {
      return;
    }

    handleYouTubeSummarization(tabId, response.url, response.videoId, response.title);
  } else {
    if (!response.content || response.content.trim().length < 30) {
      updateTabStateForRequest(tabId, requestId, {
        phase: 'error',
        title: 'Insufficient Content',
        message: 'Not enough content found on this page to summarize.',
        errorType: 'generic'
      });
      return;
    }

    if (!updateTabStateForRequest(tabId, requestId, {
      phase: 'progress',
      stage: 'generating',
      message: 'Generating summary with Claude AI...'
    })) {
      return;
    }

    handleSummarization(tabId, response.content, requestId);
  }
}

async function handleSummarization(tabId, content, requestId) {
  try {
    const result = await summarizeWithAnthropic(content, tabId);
    if (!isCurrentRequest(tabId, requestId)) {
      return;
    }
    const startTime = tabStates.get(tabId)?.startTime;
    updateTabStateForRequest(tabId, requestId, {
      phase: 'summary',
      summary: result.summary,
      model: result.model,
      metadata: null,
      durationMs: startTime ? Date.now() - startTime : null,
      requestId: null
    });
  } catch (error) {
    if (!isCurrentRequest(tabId, requestId)) {
      return;
    }
    console.error('Error:', error);
    let errorMessage = error.message || 'Error generating summary.';
    let errorType = 'generic';

    if (error.message && error.message.includes('401')) {
      errorMessage = 'Invalid API key. Please check your Anthropic API key in the extension settings.';
      errorType = 'apiKey';
    } else if (error.message && error.message.includes('429')) {
      errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
      errorType = 'rateLimit';
    } else if (error.message && error.message.includes('500')) {
      errorMessage = 'Anthropic API is experiencing issues. Please try again later.';
    } else if (error.message && error.message.includes('network')) {
      errorMessage = 'Network error. Please check your internet connection and try again.';
    }

    updateTabStateForRequest(tabId, requestId, {
      phase: 'error',
      title: errorType === 'apiKey' ? 'API Key Issue' :
             errorType === 'rateLimit' ? 'Rate Limit Exceeded' : 'Processing Error',
      message: errorMessage,
      errorType: errorType,
      requestId: null
    });
  }
}

async function handleYouTubeSummarization(tabId, videoUrl, videoId, title) {
  try {
    const result = await summarizeYouTubeWithYTS(videoUrl, videoId, title, tabId);
    const startTime = tabStates.get(tabId)?.startTime;
    updateTabState(tabId, {
      phase: 'summary',
      summary: result.summary,
      model: null,
      metadata: result.metadata,
      durationMs: startTime ? Date.now() - startTime : null
    });
  } catch (error) {
    console.error('YouTube summarization error:', error);
    updateTabState(tabId, {
      phase: 'error',
      title: 'YouTube Summarization Failed',
      message: error.message,
      errorType: 'generic'
    });
  }
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'panelReady') {
    // Side panel just loaded — send it the current tab's state
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      await stateRestored;
      if (tabs[0]) {
        const tab = tabs[0];
        const tabId = tab.id;
        let state = getTabStateSnapshot(tabId, tab);

        // Auto-start summarization when panel opens with no existing state,
        // but respond with the loading/error state immediately so the UI
        // never has to sit in the placeholder while work is already happening.
        if (state.phase === 'empty') {
          const { apiKey } = await chrome.storage.sync.get(['apiKey']);
          if (!apiKey) {
            state = updateTabState(tabId, {
              phase: 'error',
              title: 'API Key Required',
              message: 'Please set your Anthropic API key in the extension settings.',
              errorType: 'apiKey',
              url: state.url,
              pageTitle: state.pageTitle
            });
          } else {
            state = updateTabState(tabId, createLoadingState(tab));
            startSummarization(tabId);
          }
        }

        sendResponse({ tabId: tabId, state: state });
      } else {
        sendResponse({ tabId: null, state: { phase: 'empty' } });
      }
    });
    return true; // async response
  }

  if (message.action === 'retrySummarize') {
    startSummarization(message.tabId);
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.action === 'saveToReadwise') {
    saveToReadwise(message.url, message.title, message.summary, message.tags)
      .then(result => {
        chrome.runtime.sendMessage({
          action: 'readwiseSaveSuccess',
          result: result
        }).catch(() => {});
      })
      .catch(error => {
        console.error('Readwise save error:', error);
        chrome.runtime.sendMessage({
          action: 'readwiseSaveError',
          error: error.message
        }).catch(() => {});
      });
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.action === 'getReadwiseTags') {
    getReadwiseTags()
      .then(tags => {
        chrome.runtime.sendMessage({
          action: 'readwiseTagsReceived',
          tags: tags
        }).catch(() => {});
      })
      .catch(error => {
        console.error('Error fetching Readwise tags:', error);
        chrome.runtime.sendMessage({
          action: 'readwiseTagsError',
          error: error.message
        }).catch(() => {});
      });
    sendResponse({ status: 'ok' });
    return true;
  }

  return false;
});

// --- Tab Event Listeners ---

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await stateRestored;

  // Get URL/title for the newly active tab
  let url, title;
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab.url;
    title = tab.title;
  } catch (e) {
    // Tab might be a special page
  }

  // Read state AFTER async work so concurrent startSummarization() calls
  // are reflected (fixes empty-state flash when rapidly switching tabs)
  const state = getTabStateSnapshot(tabId, { url, title });

  chrome.runtime.sendMessage({
    action: 'activeTabChanged',
    tabId: tabId,
    state: state
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  persistTabStates();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Page is navigating — clear the summary for this tab
    tabStates.delete(tabId);
    persistTabStates();
    chrome.runtime.sendMessage({
      action: 'stateUpdate',
      tabId: tabId,
      state: { phase: 'empty' }
    }).catch(() => {});
  }
});

// --- Anthropic API ---

async function summarizeWithAnthropic(content, tabId) {
  const result = await chrome.storage.sync.get(['apiKey', 'enableReadwise', 'readwiseToken']);
  if (!result.apiKey) {
    throw new Error('API key not set. Please set it in the extension options.');
  }

  // Get the prompt template
  let promptTemplate = await fetch(chrome.runtime.getURL('prompt.txt'))
    .then(response => response.text())
    .catch(() => 'You are a helpful AI assistant that creates concise summaries of web page content.');

  // If Readwise is enabled, get user's tags and modify the prompt
  if (result.enableReadwise && result.readwiseToken) {
    try {
      const tags = await getReadwiseTags();
      const availableTags = tags.map(tag => tag.name);

      if (availableTags.length > 0) {
        promptTemplate = promptTemplate.replace(
          'Choose 3-5 relevant tags that would help organize this content. Include a mix of general categories (technology, business, science, health, etc.) and specific topics mentioned (product names, companies, technologies, people). Keep tags concise (1-2 words each).',
          `Choose 3-5 relevant tags that would help organize this content. You MUST select ONLY from these existing tags that the user already uses in Readwise: ${availableTags.join(', ')}. Do not create new tags - only suggest from this list.`
        );
      }
    } catch (error) {
      console.log('Could not fetch Readwise tags, using generic tag suggestions:', error);
    }
  }

  const truncatedContent = content.slice(0, 100000);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': result.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1300,
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
  return {
    summary: data.content[0].text,
    model: CLAUDE_MODEL
  };
}

// --- Readwise API ---

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

async function saveToReadwise(url, title, summary, tags) {
  const result = await chrome.storage.sync.get(['readwiseToken', 'enableReadwise']);

  if (!result.enableReadwise || !result.readwiseToken) {
    throw new Error('Readwise integration not enabled or token not set.');
  }

  const payload = {
    url: url,
    tags: tags || [],
    location: 'new'
  };

  if (title) payload.title = title;
  if (summary) payload.summary = summary;

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

  return await response.json();
}

// --- YouTube / YTS Native Messaging ---

async function summarizeYouTubeWithYTS(videoUrl, videoId, title, tabId) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.chrome_summarize.yts');
    let responseReceived = false;

    port.onMessage.addListener((response) => {
      responseReceived = true;

      if (response.success) {
        try {
          const summaryData = response.summary;
          const metadata = response.metadata;

          let summary = summaryData.tldr || 'No summary available';
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

    port.postMessage({
      action: 'summarize',
      url: videoUrl
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!responseReceived) {
        port.disconnect();
        reject(new Error('YTS processing timed out after 5 minutes'));
      }
    }, 300000);
  });
}
