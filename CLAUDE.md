# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension that summarizes web pages using Claude AI. Features include:
- Web page content extraction and summarization
- YouTube video summarization via YTS native messaging integration
- Readwise integration for saving and tagging articles
- Chrome Side Panel for displaying summaries (per-tab state)

## Project Structure

- **manifest.json**: Chrome extension manifest (v3) with Side Panel API
- **background.js**: Service worker — central state manager, API calls, tab state tracking
- **content.js**: Content script — only extracts page content (no UI)
- **sidepanel.html**: Vite entry point for the side panel (React)
- **src/**: React + TypeScript source for the side panel (Tailwind CSS v4, shadcn/ui)
- **dist/**: Built extension output (load this in Chrome)
- **prompt.txt**: Claude AI summarization prompt template
- **options.html/js**: Extension settings page for API keys
- **native-host/**: YTS integration for YouTube video summarization (uses Bun runtime)
  - Requires manual installation via `install.sh`
  - Expects YTS at `~/dev/yts/bin/yts.js`

## Prerequisites

- [Bun](https://bun.sh/) runtime for build tooling and native messaging host

## Development Commands

```bash
# Install dependencies
bun install

# Build the extension (outputs to dist/)
bun run build

# Watch mode (rebuilds on source changes)
bun run dev

# Install native messaging host (for YouTube support)
bun run install-native-host

# Load extension in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select the dist/ directory
#
# After code changes: run `bun run build`, then reload the extension

# Test extension
# Use Ctrl+Shift+S (Windows/Linux) or Cmd+Shift+S (Mac)
```

## Key Implementation Details

### API Integration
- Uses Anthropic API directly from browser with `anthropic-dangerous-direct-browser-access` header
- Model: `claude-sonnet-4-6`
- Readwise API for article saving and tag management

### Native Messaging
- YouTube videos handled via YTS tool through native messaging
- Uses Bun runtime for the native host script
- Host manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Requires extension ID configuration after installation

### Storage
- Chrome sync storage for API keys and settings
- Keys: `apiKey`, `readwiseToken`, `enableReadwise`

### Content Extraction
- Extracts main content from web pages via content script
- Special handling for YouTube video detection
- Limits content to 100,000 characters for API calls
