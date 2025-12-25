#!/bin/bash

# Set up PATH to include bun
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

# Log for debugging
echo "Native host wrapper started at $(date)" >> ~/yts-native-host-wrapper.log
echo "PATH: $PATH" >> ~/yts-native-host-wrapper.log

# Run the Bun script
exec "$HOME/.bun/bin/bun" /Users/azolotov/dev/chrome-summarize/native-host/yts-native-host.js