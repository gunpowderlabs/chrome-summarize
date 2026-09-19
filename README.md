# Chrome Page Summarizer Extension

A Chrome extension that summarizes web pages using Gemini 3.5 Flash-Lite through Vercel AI Gateway and displays the summary in a sidebar.

## Setup

### Basic Installation

First install [Bun](https://bun.sh/), then run `bun install` and `bun run build`.

1. **Open Chrome Extensions Page**
   - Go to `chrome://extensions/` in your Chrome browser
   - Or use Menu → More tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked"
   - Navigate to this project's `dist/` directory
   - Select the folder and click "Open"

4. **Configure API Key**
   - Open the extension's "Details" on `chrome://extensions/`, then "Extension options"
   - Enter your Vercel AI Gateway API key
   - (Optional) Add Readwise token if you want article saving

5. **Verify Installation**
   - The "Page Summarizer" should appear in your extensions list
   - You can now use the extension on any webpage

### Optional: YouTube Support

To enable YouTube video summarization via native messaging:

```bash
cd native-host
./install.sh
```

This requires the YTS tool at `~/dev/yts/bin/yts.js`.

## Usage

1. Navigate to any web page
2. Click the extension icon in your Chrome toolbar or use the keyboard shortcut (Ctrl+Shift+S on Windows/Linux, Command+Shift+S on Mac)
3. The extension will extract the main content, send it through AI Gateway for summarization, and display the summary in a sidebar

## Keyboard Shortcut

The extension can be triggered using:
- **Windows/Linux**: `Ctrl+Shift+S`
- **Mac**: `Command+Shift+S`

You can customize these shortcuts in Chrome by going to:
1. Navigate to `chrome://extensions/shortcuts`
2. Find "Page Summarizer" in the list
3. Click the pencil icon and set your preferred shortcut

## Model Configuration

Edit `config.ts` to change the web-page summarization model:

```ts
model: "google/gemini-3.5-flash-lite",
reasoning: "minimal",
```

Use a model ID from the [AI Gateway catalog](https://vercel.com/ai-gateway/models).
When switching models, choose a reasoning level that model supports, or set
`reasoning` to `"provider-default"`. The same file controls the input character
limit and output token budget. The current 4,096-token output limit leaves room
for the summary and minimal reasoning; it is a ceiling, not a target length.

After editing, run `bun run build` and reload the extension on
`chrome://extensions/`. These settings apply to web pages; YouTube continues to
use the separately configured YTS native host.

The summary footer displays the model and Gateway-reported request cost,
including any incomplete-summary retry. If Gateway omits cost metadata, the
footer omits the cost rather than estimating it with another model's rates.

## Customizing the Summary

Edit `prompt.txt` to change the summary style, then rebuild and reload. The model
returns a structured TL;DR, Markdown bullet summary, and topical tags.

## API Key Configuration

Create an API key in your [Vercel AI Gateway dashboard](https://vercel.com/dashboard/ai-gateway)
and save it in the extension's options page. The extension stores it under
`gatewayApiKey` in Chrome sync storage and sends requests directly to
`https://ai-gateway.vercel.sh` from its service worker.

If upgrading from the Anthropic version, enter a Gateway key after reloading.
The old Anthropic key is not reused or sent to Vercel. Readwise settings are
preserved. API keys belong in the options page, not in `config.ts` or the bundle.
