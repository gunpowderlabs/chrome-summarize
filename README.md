# Chrome Page Summarizer Extension

A Chrome extension that summarizes web pages using Claude AI and displays the summary in a sidebar.

## Setup

1. Clone this repository
2. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable Developer mode (toggle in the top right)
   - Click "Load unpacked"
   - Select this project's directory
3. Click the extension icon in your toolbar
4. Enter your Anthropic API key in the options page that appears

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

