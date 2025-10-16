# Chrome Page Summarizer Extension

A Chrome extension that summarizes web pages using Claude AI and displays the summary in a sidebar.

## Setup

### Basic Installation

1. **Open Chrome Extensions Page**
   - Go to `chrome://extensions/` in your Chrome browser
   - Or use Menu → More tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked"
   - Navigate to this project's directory
   - Select the folder and click "Open"

4. **Configure API Key**
   - Click the extension icon in your toolbar
   - Click the menu (three dots) and select "Options"
   - Enter your Anthropic API key
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
3. The extension will extract the main content, send it to Claude for summarization, and display the summary in a sidebar

## Keyboard Shortcut

The extension can be triggered using:
- **Windows/Linux**: `Ctrl+Shift+S`
- **Mac**: `Command+Shift+S`

You can customize these shortcuts in Chrome by going to:
1. Navigate to `chrome://extensions/shortcuts`
2. Find "Page Summarizer" in the list
3. Click the pencil icon and set your preferred shortcut

## Customizing the Summary

You can customize how Claude summarizes content by editing the `prompt.txt` file. This file contains the system message that guides Claude's summarization style.

## API Key Configuration

This extension requires an Anthropic API key to function. Your API key is stored securely in Chrome's sync storage and is only used to make API calls to Anthropic's Claude service. You can update or change your API key at any time through the extension's options page.

**Note:** This extension calls the Anthropic API directly from the browser. While convenient for personal use, this method uses the `anthropic-dangerous-direct-browser-access` header, which is not recommended for production applications. For production deployments, consider using a proxy server to handle API calls.

