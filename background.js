import { createAnthropic } from '@ai-sdk/anthropic';
import {
  CLAUDE_MODEL,
  streamSummary,
  buildSystemPrompt,
  classifyError,
  mapYouTubeSummary
} from './lib/summarize';

// Per-tab state store. The in-memory Map is the service worker's working copy;
// chrome.storage.session is the single source of truth the side panel reads and
// subscribes to. Every mutation is mirrored to storage via persistTabStates().
const tabStates = new Map();
let nextRequestId = 0;

// The tab/window the side panel was last opened for, captured from the user
// gesture. This is the authoritative answer to "which tab is the panel showing"
// at mount — far more reliable than a chrome.tabs query issued from inside the
// freshly-opened panel, which frequently resolves to the wrong tab or none.
let lastPanelOpen = null;

// Restore tab states from session storage (survives service worker restarts)
const stateRestored = chrome.storage.session.get('tabStates').then(({ tabStates: stored }) => {
  if (stored) {
    for (const [key, value] of Object.entries(stored)) {
      const tabId = Number(key);
      if (tabStates.has(tabId)) {
        continue;
      }

      const restoredState = { ...value };
      // Reset in-progress states — the summarization isn't running after a restart
      if (restoredState.phase === 'progress') {
        restoredState.phase = 'empty';
        delete restoredState.requestId;
        delete restoredState.startTime;
      }
      tabStates.set(tabId, restoredState);
    }
  }
});

function persistTabStates() {
  chrome.storage.session.set({ tabStates: Object.fromEntries(tabStates) });
}

// Mutating a tab's state writes it straight to session storage. The panel
// observes those writes via chrome.storage.onChanged — a reliable cross-context
// channel — instead of runtime.sendMessage broadcasts, which the service worker
// can silently drop before the panel ever receives them.
function setTabState(tabId, state, { persist = true } = {}) {
  tabStates.set(tabId, state);
  if (persist) {
    persistTabStates();
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

// Publish a partial streamed summary. Each throttled delta is written to session
// storage so the panel renders it live; STREAM_THROTTLE_MS keeps the write rate
// sane. Session storage is in-memory, so frequent writes are cheap.
function streamSummaryUpdate(tabId, requestId, partial) {
  if (!isCurrentRequest(tabId, requestId)) {
    return false;
  }
  const current = tabStates.get(tabId) || { phase: 'empty' };
  setTabState(tabId, {
    ...current,
    phase: 'summary',
    tldr: partial.tldr || null,
    summary: partial.summary || '',
    tags: partial.tags || [],
    model: CLAUDE_MODEL,
    metadata: null,
    costUsd: null,
    streaming: true
  });
  return true;
}

// Min interval between streamed UI updates (ms) — keeps the panel smooth
// without flooding it with a message per token.
const STREAM_THROTTLE_MS = 90;

// --- State Management ---

function updateTabState(tabId, partialState) {
  const current = tabStates.get(tabId) || { phase: 'empty' };
  const newState = { ...current, ...partialState };
  return setTabState(tabId, newState);
}

// Disable side panel globally by default — only show on tabs where user explicitly opens it.
// Also force action clicks through our handler so opening the panel always starts summarization.
chrome.sidePanel.setOptions({ enabled: false }).catch((error) => {
  console.warn('Unable to disable global side panel:', error);
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
  console.warn('Unable to configure side panel action behavior:', error);
});

// --- Action Click / Keyboard Shortcut ---

async function summarizeTabFromUserGesture(tab) {
  if (!tab?.id) {
    return;
  }

  // Record the tab/window so panelReady can bind the panel to exactly this tab.
  lastPanelOpen = { tabId: tab.id, windowId: tab.windowId };

  // Enable side panel for this specific tab and open it
  // setOptions must not be awaited — any await before open() breaks the user gesture chain
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });

  // Publish the loading state before opening the panel so the panel's first read
  // from storage already shows progress instead of the empty placeholder.
  const loadingState = createLoadingState(tab);
  setTabState(tab.id, loadingState);

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.warn('Unable to open side panel:', error);
  }

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
}

function runSummarizeTabFromUserGesture(tab) {
  summarizeTabFromUserGesture(tab).catch((error) => {
    console.error('Failed to start summarization:', error);
  });
}

chrome.action.onClicked.addListener((tab) => {
  runSummarizeTabFromUserGesture(tab);
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
    let lastFlush = 0;
    const onPartial = (partial) => {
      const now = Date.now();
      if (now - lastFlush < STREAM_THROTTLE_MS) {
        return;
      }
      lastFlush = now;
      streamSummaryUpdate(tabId, requestId, partial);
    };

    const result = await summarizeWithAnthropic(content, tabId, onPartial);
    if (!isCurrentRequest(tabId, requestId)) {
      return;
    }
    const startTime = tabStates.get(tabId)?.startTime;
    updateTabStateForRequest(tabId, requestId, {
      phase: 'summary',
      tldr: result.summary.tldr,
      summary: result.summary.summary,
      tags: result.summary.tags,
      model: result.model,
      metadata: null,
      costUsd: result.costUsd,
      streaming: false,
      durationMs: startTime ? Date.now() - startTime : null,
      requestId: null
    });
  } catch (error) {
    if (!isCurrentRequest(tabId, requestId)) {
      return;
    }
    console.error('Error:', error);
    const { errorType, title, message } = classifyError(error);
    updateTabStateForRequest(tabId, requestId, {
      phase: 'error',
      title,
      message,
      errorType,
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
      tldr: null,
      summary: result.summary,
      tags: result.tags,
      model: null,
      metadata: result.metadata,
      costUsd: null,
      streaming: false,
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
    // Side panel just loaded — tell it which tab it owns and that tab's state.
    (async () => {
      await stateRestored;

      // Resolve the panel's tab. Prefer the tab the user gesture opened it for;
      // fall back to an active-tab query (e.g. after a service-worker restart
      // dropped lastPanelOpen). The query runs in the worker, not the panel, so
      // it isn't subject to the panel-context race that returns the wrong tab.
      let tab = null;
      if (lastPanelOpen) {
        tab = await chrome.tabs.get(lastPanelOpen.tabId).catch(() => null);
      }
      if (!tab) {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tab = active || null;
      }

      if (!tab?.id) {
        sendResponse({ tabId: null, windowId: null, state: { phase: 'empty' } });
        return;
      }

      const tabId = tab.id;
      let state = getTabStateSnapshot(tabId, tab);

      // Auto-start summarization when the panel opens with no existing state,
      // so the UI never sits in the placeholder while it could be working.
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

      sendResponse({ tabId: tabId, windowId: tab.windowId, state: state });
    })();
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
// The side panel tracks the active tab itself (via chrome.tabs.onActivated) and
// reads each tab's state from storage, so the worker no longer broadcasts tab
// changes — it just keeps storage current.

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStates.delete(tabId)) {
    persistTabStates();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Page is navigating — clear the summary. The storage write propagates to
    // the panel if this is the tab it's currently showing.
    if (tabStates.delete(tabId)) {
      persistTabStates();
    }
  }
});

// --- Anthropic API ---

// Stream a structured summary via the AI SDK. onPartial receives progressively
// more complete { tldr, summary, tags } objects; the resolved value is the
// fully validated object.
async function summarizeWithAnthropic(content, tabId, onPartial = () => {}) {
  const result = await chrome.storage.sync.get(['apiKey', 'enableReadwise', 'readwiseToken']);
  if (!result.apiKey) {
    throw new Error('API key not set. Please set it in the extension options.');
  }

  // Get the prompt template
  const basePrompt = await fetch(chrome.runtime.getURL('prompt.txt'))
    .then(response => response.text())
    .catch(() => 'You are a helpful AI assistant that creates concise summaries of web page content.');

  // If Readwise is enabled, constrain the tags to the user's existing set
  let availableTags = [];
  if (result.enableReadwise && result.readwiseToken) {
    try {
      const tags = await getReadwiseTags();
      availableTags = tags.map(tag => tag.name);
    } catch (error) {
      console.log('Could not fetch Readwise tags, using generic tag suggestions:', error);
    }
  }

  // Anthropic has no native JSON mode, so the SDK forces structure via a tool
  // call. The dangerous-direct-browser-access header is required to call the
  // API directly from the extension (no CORS proxy).
  const anthropic = createAnthropic({
    apiKey: result.apiKey,
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' }
  });

  const summary = await streamSummary({
    model: anthropic(CLAUDE_MODEL),
    system: buildSystemPrompt(basePrompt, availableTags),
    prompt: content.slice(0, 100000),
    // Medium-effort adaptive thinking. Claude counts thinking tokens against
    // max_tokens, so give the output room beyond the ~1500-token summary.
    maxOutputTokens: 8000,
    providerOptions: {
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'medium'
      }
    },
    pricingModelId: CLAUDE_MODEL,
    onPartial
  });

  return { ...summary, model: CLAUDE_MODEL };
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
          resolve(mapYouTubeSummary(response.summary, response.metadata));
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
