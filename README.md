# Chrome Page Summarizer Extension

A Chrome extension that summarizes web pages using Claude AI and displays the summary in a sidebar.

## Setup

1. Clone this repository
2. Copy `.env.example` to `.env` and add your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the backend server:
   ```
   npm start
   ```
5. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable Developer mode (toggle in the top right)
   - Click "Load unpacked"
   - Select this project's directory

## Usage

1. Navigate to any web page
2. Click the extension icon in your Chrome toolbar
3. The extension will extract the main content, send it to Claude for summarization, and display the summary in a sidebar

## Customizing the Summary

You can customize how Claude summarizes content by editing the `prompt.txt` file. This file contains the system message that guides Claude's summarization style.

## Icon Setup

Before using the extension, you need to create icon files in the `icons` directory:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

You can use any image editor to create simple icons, or download placeholder icons from various free icon websites.
