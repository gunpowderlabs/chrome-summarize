---
name: fix-article-extraction
description: >-
  Fix the chrome-summarize Chrome extension's page content extraction for ONE
  specific site or URL where the summary is wrong — it grabbed the nav, sidebar,
  trending/"Live on X" widgets, comments, or boilerplate instead of the actual
  article/post. Use when the user runs /fix-article-extraction, or says the
  summarizer "extracts the wrong content", "grabbed the sidebar", "summarized
  trending instead of the article", or "isn't reading the article" on a given
  site. Edits content.js in the chrome-summarize repo.
---

# Fix Article Extraction

Diagnose and fix `content.js` extraction for **one site/URL** where the Page
Summarizer extracts the wrong text (sidebar, nav, trending widgets, comments,
related-articles, cookie/boilerplate) instead of the real article or post.

**Argument:** a site or URL, optionally with a note on the symptom.
e.g. `/fix-article-extraction https://x.com/user/status/123 — summarized the trending sidebar`

**Working dir:** the `chrome-summarize` repo (default `~/dev/chrome-summarize`).
If you're not there, `cd` into it first.

---

## How extraction works — read `content.js` before changing anything

`extractMainContent()` in `content.js` runs in this order:

1. **Site-specific branches**, gated by `hostname`, at the top of the function
   (currently X/Twitter and LinkedIn; YouTube is detected earlier in the message
   handler). Each targets a known container by a stable selector, returns its
   `innerText`, and short-circuits.
2. **Generic candidate scan** — gathers `article, main, #content, [role="main"],
   .post, .article, .entry, .content`, drops menus/widgets via
   `looksLikeContent()` (rejects boilerplate, `linkDensity > 0.5`, or text > 400
   chars with `blockCount === 0`), and returns the highest `scoreContent()` match.
3. **Fallbacks** — text-rich content `div`, then a `<p>` join, then the
   last resort `document.body.innerText`.

**Why a site extracts wrong:** its real content container gets rejected by the
generic scorer — usually because the site uses **no `<p>` tags** (React SPAs,
rich-text editors), **hashed CSS-in-JS class names** (`css-1dbjc4n`) that the
candidate selectors don't match, or **high link density** from inline links — so
extraction falls through to a fallback that captures page chrome / sidebar / the
whole `body`. The fix is almost always a **site-specific branch** that targets
the real container directly. (Reference: X failed because the page has zero `<p>`
tags, so every candidate was rejected and it fell through to `body.innerText`,
which includes the trending sidebar.)

---

## Procedure

### 1. Pin down the target and symptom
Get the URL and what's wrong. If only a bare domain was given, ask for one
representative URL that reproduces the problem.

### 2. Inspect the live DOM
**If browser automation is available** (Claude-in-Chrome `javascript_tool`, or
the chrome-devtools `evaluate_script` MCP): open the URL and run the **diagnostic
snippet** below.

**Otherwise (e.g. Codex with no browser):** print the snippet and ask the user to
open the page, paste it into DevTools Console (F12 → Console), and paste the JSON
back. Logged-in pages (X, LinkedIn) can't be fetched headlessly, so this is the
reliable path.

```js
(() => {
  const linkDensity = el => { const t=(el.innerText||'').trim().length||1; let l=0; el.querySelectorAll('a').forEach(a=>l+=(a.innerText||'').length); return +(l/t).toFixed(2); };
  const sum = el => el ? { sel: el.tagName + (el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : ''), len: (el.innerText||'').trim().length, links: linkDensity(el), head: (el.innerText||'').trim().slice(0,120) } : null;
  const sels = ['article','main','[role="main"]','#content','.post','.article','.entry','.content'];
  const candidates = [...new Set(sels.flatMap(s => [...document.querySelectorAll(s)]))].map(sum).sort((a,b)=>b.len-a.len);
  const byTestId = [...document.querySelectorAll('[data-testid]')].map(sum).filter(x=>x.len>200).sort((a,b)=>b.len-a.len).slice(0,12);
  return JSON.stringify({ url: location.href, host: location.hostname, totalP: document.querySelectorAll('p').length, bodyLen: document.body.innerText.trim().length, candidates, byTestId }, null, 2);
})()
```

What to look for in the output:
- `totalP: 0` → the no-`<p>` failure mode (the generic scorer rejects big blocks).
- `candidates` with high `links` (> 0.5) or huge `len` covering the whole page →
  why the wrong thing gets picked / rejected.
- `byTestId` → the **stable selectors** to target. Pick the entry whose `head`
  starts with the real content and whose `len` matches the article (not the
  whole page, not a tiny widget).

### 3. Decide the selector
Prefer selectors in this order, choosing the most specific container that holds
the real content and structurally excludes the sidebar/nav:
1. `data-testid` / other `data-*` attributes
2. semantic landmarks (`<article>`, `[role="main"]`, `[role="article"]`)
3. stable `id`s
4. ARIA labels (`[aria-label="…"]`)

**Never** target hashed CSS-in-JS class names (`css-1dbjc4n`, `sc-a1b2c3`) — they
change between builds.

### 4. Implement the fix
Add a `hostname`-gated branch near the top of `extractMainContent()`, mirroring
the existing X/LinkedIn branches. Template:

```js
// <Site>: <one line on the DOM quirk — e.g. React app, no <p> tags, noisy sidebar>.
// The generic scorer grabs <the noise>, so target <the real container> directly.
if (hostname.includes('example.com')) {
  // Most-specific container first, with ordered fallbacks for page variants.
  const main = document.querySelector('[data-testid="primary-content"]');
  if (main && main.innerText.trim().length > 50) {
    return main.innerText;
  }
}
```

Rules:
- Cover variants with ordered fallbacks (e.g. long-form article vs short post —
  see how the X branch handles `twitterArticleRichTextView` then `tweetText`).
- Target the **primary content region** so the sidebar/nav is excluded by
  structure, not by guesswork.
- Guard every `return` on `.trim().length > 50`.
- **If the symptom is general** (several sites break for the same reason, e.g. no
  `<p>` tags), prefer improving the generic helpers (`blockCount`,
  `looksLikeContent`, `scoreContent`) over adding yet another per-site branch.

### 5. Validate — required
Re-run the diagnostic (or your selector) against the live page (browser) or have
the user re-run it. Confirm the result:
- **contains** the real article/post text,
- **does NOT contain** the known noise (sidebar/nav/trending labels — grep the
  text for things like `Live on X`, `What's happening`, `Trending`, nav items),
- has a **sensible length** (close to the article, not the whole `body`).

Quick selector check to paste in the console:
```js
const el = document.querySelector('YOUR_SELECTOR');
({ len: el?.innerText.trim().length, head: el?.innerText.trim().slice(0,160) })
```

### 6. Housekeeping
- Run `bun run ci` — typecheck + tests + build must pass.
- Bump the version in **both** `manifest.json` and `package.json` (keep them in
  sync) — **patch** bump for an extraction fix.
- Confirm the change landed in the build: `grep "your-new-selector" dist/content.js`.
- Tell the user to reload the extension at `chrome://extensions/` and re-test on
  the page.
- **Do not commit** unless the user explicitly asks. If they do, use a
  conventional commit like `fix(extraction): handle <site> article pages`.

---

## Reference: existing site branches in `content.js`

X / Twitter (long-form article → tweet/thread → primary column, never the sidebar):
```js
if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
  const articleRichText = document.querySelector('[data-testid="twitterArticleRichTextView"]');
  if (articleRichText && articleRichText.innerText.trim().length > 50) {
    return articleRichText.innerText;
  }
  const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
  if (primaryColumn) {
    const tweetTexts = Array.from(primaryColumn.querySelectorAll('[data-testid="tweetText"]'))
      .map(t => t.innerText.trim()).filter(Boolean);
    if (tweetTexts.length > 0) return tweetTexts.join('\n\n');
    if (primaryColumn.innerText.trim().length > 50) return primaryColumn.innerText;
  }
}
```

LinkedIn (post body inside the article role):
```js
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
```
