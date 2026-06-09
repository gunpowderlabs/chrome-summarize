// Content script — only handles content extraction (UI is in the side panel)

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

function isBoilerplate(el) {
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toString().toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const boilerplate = [
    'cookie', 'consent', 'gdpr', 'privacy-banner', 'onetrust',
    'cybotcookiebot', 'cc-banner', 'cc-window',
  ];
  return boilerplate.some(p => id.includes(p) || cls.includes(p)) || role === 'dialog';
}

function hasBoilerplateAncestor(el) {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (isBoilerplate(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

// Fraction of an element's text that lives inside links. Navigation menus,
// footers, and link lists score high; article prose scores near zero.
function linkDensity(el) {
  const total = (el.innerText || '').trim().length || 1;
  let linkLen = 0;
  el.querySelectorAll('a').forEach(a => { linkLen += (a.innerText || '').length; });
  return linkLen / total;
}

// Counts block-level separators that signal paragraph structure. Real prose is
// broken into blocks; nav blobs and link lists are not. Crucially, not every
// site uses <p> — React SPAs and rich-text editors (X, Notion, etc.) lean on
// <div>/<br>/headings — so the absence of <p> alone must not mean "unstructured".
function blockCount(el) {
  return el.querySelectorAll('p, br, li, h1, h2, h3, h4, h5, h6, blockquote').length;
}

// Distinguishes real article content from menus/widgets. A semantic container
// like <article> is no guarantee of prose — sites wrap off-canvas nav drawers
// in <article> too — so reject blocks that are mostly links or that carry a lot
// of text with no block structure of any kind.
function looksLikeContent(el) {
  const text = (el.innerText || '').trim();
  if (text.length < 50) return false;
  if (isBoilerplate(el) || hasBoilerplateAncestor(el)) return false;
  if (linkDensity(el) > 0.5) return false;
  if (text.length > 400 && blockCount(el) === 0) return false;
  return true;
}

// Higher is more article-like: reward text volume and block structure,
// discount text that is mostly links.
function scoreContent(el) {
  const text = (el.innerText || '').trim();
  return text.length * (1 - linkDensity(el)) + blockCount(el) * 100;
}

function extractMainContent() {
  const hostname = window.location.hostname;

  // X / Twitter-specific extraction. The page is a React app with no <p> tags
  // and a noisy right-hand sidebar (Search, "Live on X", "What's happening",
  // trending). The generic scorer can grab that sidebar — or fall through to
  // document.body.innerText — and summarize trending topics instead of the post.
  // Target the primary column explicitly; it never contains the sidebar.
  if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
    // Long-form Article reader view
    const articleRichText = document.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (articleRichText && articleRichText.innerText.trim().length > 50) {
      return articleRichText.innerText;
    }
    // Regular tweet / thread: concatenate the post text blocks in the primary column
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (primaryColumn) {
      const tweetTexts = Array.from(primaryColumn.querySelectorAll('[data-testid="tweetText"]'))
        .map(t => t.innerText.trim())
        .filter(Boolean);
      if (tweetTexts.length > 0) {
        return tweetTexts.join('\n\n');
      }
      if (primaryColumn.innerText.trim().length > 50) {
        return primaryColumn.innerText;
      }
    }
  }

  // LinkedIn-specific extraction
  if (hostname.includes('linkedin.com')) {
    const linkedInArticle = document.querySelector('[role="article"]');
    if (linkedInArticle) {
      const postDescription = linkedInArticle.querySelector('[class*="feed-shared-update-v2__description"]') ||
                             linkedInArticle.querySelector('[class*="feed-shared-inline-show-more-text"]');
      if (postDescription && postDescription.innerText.trim().length > 50) {
        return postDescription.innerText;
      }
    }
  }

  // Common content container elements. Don't trust DOM order: gather every
  // match, drop menus/widgets, and pick the most article-like by score. A naive
  // querySelector('article') would grab the first <article>, which on many sites
  // is a nav drawer rather than the page content.
  const candidates = [
    'article', 'main', '#content', '[role="main"]',
    '.post', '.article', '.entry', '.content'
  ];
  const matches = [];
  const seen = new Set();
  for (const selector of candidates) {
    document.querySelectorAll(selector).forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      if (looksLikeContent(el)) matches.push(el);
    });
  }
  if (matches.length > 0) {
    matches.sort((a, b) => scoreContent(b) - scoreContent(a));
    return matches[0].innerText;
  }

  // Text-richest content-like div (skip menus, cookie/GDPR banners, etc.)
  const contentDivs = Array.from(document.querySelectorAll('div'))
    .filter(div => {
      const text = div.innerText || '';
      return text.length > 200 &&
             div.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0 &&
             looksLikeContent(div);
    })
    .sort((a, b) => scoreContent(b) - scoreContent(a));

  if (contentDivs.length > 0) {
    return contentDivs[0].innerText;
  }

  // Paragraphs fallback
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .filter(p => (p.innerText || '').length > 30)
    .map(p => p.innerText)
    .join('\n\n');

  if (paragraphs && paragraphs.length > 100) {
    return paragraphs;
  }

  // Last resort
  const bodyText = document.body.innerText;
  if (bodyText && bodyText.length > 200) {
    return bodyText;
  }

  return '';
}
