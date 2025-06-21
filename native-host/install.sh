#!/bin/bash

# Chrome Native Messaging Host Installation Script for macOS

echo "Installing YTS Native Messaging Host..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Make the host script executable
chmod +x "$SCRIPT_DIR/yts-native-host.js"

# Chrome native messaging hosts directory on macOS
CHROME_NMH_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Create directory if it doesn't exist
mkdir -p "$CHROME_NMH_DIR"

# Copy the manifest file
cp "$SCRIPT_DIR/com.chrome_summarize.yts.json" "$CHROME_NMH_DIR/"

echo "Native messaging host installed to: $CHROME_NMH_DIR"
echo ""
echo "IMPORTANT: You need to update the extension ID in the manifest file!"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Find 'Page Summarizer' and copy its ID"
echo "4. Edit $CHROME_NMH_DIR/com.chrome_summarize.yts.json"
echo "5. Replace YOUR_EXTENSION_ID_HERE with the actual extension ID"
echo ""
echo "Example: chrome-extension://abcdefghijklmnopqrstuvwxyz/"
echo ""
echo "After updating the ID, reload the extension in Chrome."