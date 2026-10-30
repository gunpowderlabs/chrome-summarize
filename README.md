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
4. To apply the resource to your life, open the **Prompt** tab and click **Copy prompt**. Paste it into your AI chat. The prompt includes the resource link and asks for practical steps based on your goals and circumstances. It does not include the summary.

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
model: "openai/gpt-6.1-terra",
reasoning: "low",
providerOptions: { gateway: { only: ["openai"] } },
```

Use a model ID from the [AI Gateway catalog](https://vercel.com/ai-gateway/models).
When switching models, choose a reasoning level that model supports, or set
`reasoning` to `"provider-default"`. Update or remove the provider restriction
when switching away from OpenAI. The same file controls the input character
limit and output token budget. The current 16,384-token output limit leaves room
for the summary and reasoning; it is a ceiling, not a target length.

After editing, run `bun run build` and reload the extension on
`chrome://extensions/`. These settings apply to web pages; YouTube continues to
use the separately configured YTS native host.

The summary footer displays the model and Gateway-reported request cost,
including any incomplete-summary retry. If Gateway omits cost metadata, the
footer omits the cost rather than estimating it with another model's rates.

## Diagnostics

Recent summary attempts and extraction/YouTube failures are saved locally. On an
error, click **Copy diagnostics** to copy that request's JSON report. To inspect
failures that recovered on retry, open extension **Settings → Export diagnostics**
and share the downloaded `page-summarizer-diagnostics-<timestamp>.json` file.

Logs include the model, extension version, attempt number, settings, finish reason,
timing, token usage, errors and causes, validation issues, and the failed response.
Successful responses and the full source page/system prompt are not recorded.
Saved API keys and tokens are redacted, and page URLs omit query strings and
fragments. Failed responses can still contain text from the page.

The history survives browser restarts and keeps up to 50 events within 1 MB.
Failed response text is limited to 32,768 characters; longer text retains its
beginning and end and is marked as truncated. **Clear diagnostics** in Settings
removes the history without changing API keys or other settings.

## Customizing the Summary

Edit `prompt.txt` to change the summary style, then rebuild and reload. The model
returns a TL;DR, separate arrays of summary bullets and application steps, an
explanation when no useful application exists, and topical tags. The panel renders
lists and headings directly and supports inline bold within each item. Existing
cached summaries and YouTube summaries retain their Markdown rendering.

## API Key Configuration

Create an API key in your [Vercel AI Gateway dashboard](https://vercel.com/dashboard/ai-gateway)
and save it in the extension's options page. The extension stores it under
`gatewayApiKey` in Chrome sync storage and sends requests directly to
`https://ai-gateway.vercel.sh` from its service worker.

### OpenAI credits through BYOK

1. Confirm your credits are in the OpenAI API organization that owns your key.
2. In the same Vercel team that owns the extension's Gateway key, open
   **AI Gateway → Bring Your Own Key → OpenAI → Add Key**. Add the OpenAI key,
   test it, and confirm it is enabled and marked **In Use**.
3. Keep the **Vercel AI Gateway key** in the extension settings. The OpenAI key
   stays in Vercel; do not put it in the extension, source code, or bundle.
4. Rebuild and reload, summarize a page, and check **AI Gateway → Logs** for
   the OpenAI provider and BYOK credential source. Confirm credit usage in the
   OpenAI organization's billing dashboard.

[Vercel BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)
requires purchased Gateway credits. If your OpenAI credential fails, Gateway
can fall back to its own credentials and charge your Gateway balance, even with
`only: ["openai"]`. A successful summary alone does not prove that OpenAI credits
paid for it. Dashboard BYOK credentials apply across the Vercel team; when
multiple OpenAI keys are enabled, Gateway uses the oldest enabled key.

If upgrading from the Anthropic version, enter a Gateway key after reloading.
The old Anthropic key is not reused or sent to Vercel. Readwise settings are
preserved. API keys belong in the options page, not in `config.ts` or the bundle.
