#!/bin/bash

# Exit on error
set -e

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file from example..."
  cp .env.example .env
  echo "Please edit .env and add your Anthropic API key."
fi

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Create placeholder icons
echo "Creating placeholder icons..."
mkdir -p icons

# Instructions for manual steps
echo ""
echo "Setup complete! Next steps:"
echo "1. Edit .env to add your Anthropic API key"
echo "2. Create icons in the 'icons' directory (icon16.png, icon48.png, icon128.png)"
echo "3. Start the server with 'npm start'"
echo "4. Load the extension in Chrome from chrome://extensions/ (Developer mode)"
