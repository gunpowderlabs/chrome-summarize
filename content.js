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

function extractMainContent() {
  // LinkedIn-specific extraction
  if (window.location.hostname.includes('linkedin.com')) {
    const linkedInArticle = document.querySelector('[role="article"]');
    if (linkedInArticle) {
      const postDescription = linkedInArticle.querySelector('[class*="feed-shared-update-v2__description"]') ||
                             linkedInArticle.querySelector('[class*="feed-shared-inline-show-more-text"]');
      if (postDescription && postDescription.innerText.trim().length > 50) {
        return postDescription.innerText;
      }
    }
  }

  // Common content container elements (skip if inside a cookie/consent dialog)
  const candidates = [
    'article', 'main', '.content', '#content',
    '.article', '.post', '.entry', '[role="main"]'
  ];
  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 50 && !isBoilerplate(el) && !hasBoilerplateAncestor(el)) {
      return el.innerText;
    }
  }

  // Text-richest div (skip cookie consent, GDPR banners, etc.)
  const contentDivs = Array.from(document.querySelectorAll('div'))
    .filter(div => {
      const text = div.innerText || '';
      return text.length > 200 &&
             div.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0 &&
             !isBoilerplate(div) &&
             !hasBoilerplateAncestor(div);
    })
    .sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);

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
