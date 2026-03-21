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

  // Common content container elements
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

  // Text-richest div
  const contentDivs = Array.from(document.querySelectorAll('div'))
    .filter(div => {
      const text = div.innerText || '';
      return text.length > 200 && div.querySelectorAll('p, h1, h2, h3, h4, h5, h6').length > 0;
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
