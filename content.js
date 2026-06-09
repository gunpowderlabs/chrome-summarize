// Content script — only handles content extraction (UI is in the side panel).
// Bundled by vite.config.content.ts so the Defuddle import gets inlined.

import Defuddle from 'defuddle';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    if (isYouTubeVideo()) {
      sendResponse({
        isYouTube: true,
        videoId: getYouTubeVideoId(),
        url: window.location.href,
        title: document.title,
        content: null
      });
    } else {
      sendResponse({
        isYouTube: false,
        content: extractMainContent(),
        url: window.location.href,
        title: document.title
      });
    }
    return true;
  }
});

function isYouTubeVideo() {
  return window.location.hostname.includes('youtube.com') &&
         window.location.pathname === '/watch';
}

function getYouTubeVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TR', 'HR'
]);

// Defuddle returns content as an HTML string; flatten it to plain text with
// paragraph breaks preserved. Parsed detached, so innerText (which needs
// layout) is not an option — walk the tree and emit newlines around blocks.
function htmlToText(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const parts = [];
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.nodeValue.replace(/\s+/g, ' '));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'BR') {
          parts.push('\n');
          continue;
        }
        const isBlock = BLOCK_TAGS.has(child.tagName);
        if (isBlock) parts.push('\n');
        walk(child);
        if (isBlock) parts.push('\n');
      }
    }
  })(body);
  return parts.join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMainContent() {
  try {
    const result = new Defuddle(document, { url: window.location.href }).parse();
    const text = htmlToText(result.content || '');
    // Site-specific extractor output (X, LinkedIn, Reddit, etc.) is trusted
    // even when short — a tweet is a few words. Generic extraction needs some
    // substance before we trust it over the whole-page fallback.
    if (result.extractorType && text.length > 0) return text;
    if (text.length >= 200) return text;
  } catch (error) {
    console.warn('Defuddle extraction failed, falling back to body text', error);
  }

  return (document.body.innerText || '').trim();
}
