# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension that summarizes web pages using Claude AI. Features include:
- Web page content extraction and summarization
- YouTube video summarization via YTS native messaging integration
- Readwise integration for saving and tagging articles
- Sidebar display for summaries

## Project Structure

- **manifest.json**: Chrome extension manifest (v3)
- **background.js**: Service worker handling API calls to Anthropic, Readwise, and YTS native messaging
- **content.js**: Content script for page extraction and sidebar UI
- **sidebar.css**: Sidebar styling
- **prompt.txt**: Claude AI summarization prompt template
- **options.html/js**: Extension settings page for API keys
- **native-host/**: YTS integration for YouTube video summarization
  - Requires manual installation via `install.sh`
  - Expects YTS at `~/dev/yts/bin/yts.js`

## Development Commands

```bash
# Install native messaging host (for YouTube support)
cd native-host && ./install.sh

# Load extension in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select this directory

# Test extension
# Use Ctrl+Shift+S (Windows/Linux) or Cmd+Shift+S (Mac)
```

## Key Implementation Details

### API Integration
- Uses Anthropic API directly from browser with `anthropic-dangerous-direct-browser-access` header
- Model: `claude-sonnet-4-20250514`
- Readwise API for article saving and tag management

### Native Messaging
- YouTube videos handled via YTS tool through native messaging
- Host manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Requires extension ID configuration after installation

### Storage
- Chrome sync storage for API keys and settings
- Keys: `apiKey`, `readwiseToken`, `enableReadwise`

### Content Extraction
- Extracts main content from web pages via content script
- Special handling for YouTube video detection
- Limits content to 100,000 characters for API calls