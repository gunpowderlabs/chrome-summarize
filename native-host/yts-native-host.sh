#!/bin/bash

# Set up PATH to include homebrew
export PATH="/opt/homebrew/bin:$PATH"

# Log for debugging
echo "Native host wrapper started at $(date)" >> ~/yts-native-host-wrapper.log
echo "PATH: $PATH" >> ~/yts-native-host-wrapper.log

# Run the Node.js script
exec /opt/homebrew/bin/node /Users/azolotov/dev/chrome-summarize/native-host/yts-native-host.js