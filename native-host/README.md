# YTS Native Messaging Host Setup

This directory contains the native messaging host that enables the Chrome extension to communicate with the YTS tool for YouTube video summarization.

## Installation Steps

1. **Install the native messaging host:**
   ```bash
   cd native-host
   ./install.sh
   ```

2. **Get your Chrome extension ID:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Find "Page Summarizer" extension
   - Copy the extension ID (looks like: `abcdefghijklmnopqrstuvwxyz`)

3. **Update the manifest with your extension ID:**
   ```bash
   # Edit the installed manifest file
   nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.chrome_summarize.yts.json
   ```
   
   Replace `YOUR_EXTENSION_ID_HERE` with your actual extension ID.
   
   The line should look like:
   ```json
   "allowed_origins": [
     "chrome-extension://abcdefghijklmnopqrstuvwxyz/"
   ]
   ```

4. **Ensure YTS is properly installed:**
   - The native host expects YTS to be located at: `~/dev/yts/bin/yts.js`
   - Make sure YTS has all its dependencies installed and is working
   - Test YTS manually: `node ~/dev/yts/bin/yts.js https://youtube.com/watch?v=VIDEO_ID`

5. **Reload the Chrome extension:**
   - Go back to `chrome://extensions/`
   - Click the reload button on the Page Summarizer extension

## How It Works

1. When you click the extension on a YouTube video, it detects the YouTube URL
2. The extension sends a message to the native host via Chrome's native messaging API
3. The native host executes the YTS command-line tool
4. YTS downloads the video, transcribes it, and generates a summary
5. The native host reads the generated files and sends the summary back to the extension
6. The extension displays the summary in the sidebar with video metadata

## Troubleshooting

- **Check logs:** The native host logs to `~/yts-native-host.log`
- **Verify permissions:** Make sure `yts-native-host.js` is executable
- **Extension ID:** Double-check the extension ID in the manifest matches your extension
- **YTS location:** Ensure YTS is installed at the expected path or update the path in `yts-native-host.js`

## File Structure

- `yts-native-host.js` - The Node.js script that handles native messaging
- `com.chrome_summarize.yts.json` - Native messaging host manifest
- `install.sh` - Installation script for macOS
- `README.md` - This file