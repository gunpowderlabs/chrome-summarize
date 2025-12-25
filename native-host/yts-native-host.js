#!/usr/bin/env bun

import { spawn } from 'child_process';
import { join } from 'path';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';

const HOME = process.env.HOME;

// Log errors to file for debugging (native messaging can't use console.log)
const logFile = join(HOME, 'yts-native-host.log');
function logError(message) {
  const timestamp = new Date().toISOString();
  appendFileSync(logFile, `${timestamp}: ${message}\n`);
}

// Log startup
logError('Native host started');
logError('Bun version: ' + Bun.version);
logError('Script path: ' + import.meta.path);
logError('Working directory: ' + process.cwd());
logError('PATH: ' + process.env.PATH);

// Native messaging protocol: read message length (4 bytes), then message
function readMessage(callback) {
  let input = Buffer.alloc(0);
  
  process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      input = Buffer.concat([input, chunk]);
      
      // Check if we have the message length
      if (input.length >= 4) {
        const messageLength = input.readUInt32LE(0);
        
        // Check if we have the full message
        if (input.length >= 4 + messageLength) {
          const messageText = input.slice(4, 4 + messageLength).toString();
          
          try {
            const message = JSON.parse(messageText);
            callback(message);
          } catch (e) {
            sendMessage({ error: 'Invalid JSON: ' + e.message });
          }
          
          // Remove processed message from buffer
          input = input.slice(4 + messageLength);
        }
      }
    }
  });
}

// Native messaging protocol: write message length (4 bytes), then message
function sendMessage(message) {
  const messageText = JSON.stringify(message);
  const messageBuffer = Buffer.from(messageText);
  const lengthBuffer = Buffer.allocUnsafe(4);
  lengthBuffer.writeUInt32LE(messageBuffer.length, 0);
  
  process.stdout.write(lengthBuffer);
  process.stdout.write(messageBuffer);
}

// Handle incoming messages
readMessage((message) => {
  logError('Received message: ' + JSON.stringify(message));
  
  if (message.action === 'summarize' && message.url) {
    // Path to yts command - adjust this based on where yts is installed
    const ytsPath = join(HOME, 'dev', 'yts', 'bin', 'yts.js');

    // Check if yts exists
    if (!existsSync(ytsPath)) {
      sendMessage({ 
        error: 'YTS tool not found at expected location',
        path: ytsPath 
      });
      return;
    }
    
    // Execute yts command with --quiet flag
    const yts = spawn('bun', [ytsPath, message.url, '--quiet'], {
      env: { ...process.env }
    });
    
    let outputData = '';
    let errorData = '';
    
    yts.stdout.on('data', (data) => {
      outputData += data.toString();
    });
    
    yts.stderr.on('data', (data) => {
      errorData += data.toString();
      logError('YTS stderr: ' + data.toString());
    });
    
    yts.on('close', (code) => {
      logError(`YTS process exited with code ${code}`);
      
      if (code === 0) {
        try {
          // Try to find the JSON summary file
          // YTS saves summaries in ~/Library/Application Support/yts/{title}/summary.json
          const appSupportPath = join(
            HOME,
            'Library',
            'Application Support',
            'yts'
          );

          // Find the most recently created directory
          const dirs = readdirSync(appSupportPath)
            .map(name => ({
              name,
              path: join(appSupportPath, name),
              stat: statSync(join(appSupportPath, name))
            }))
            .filter(item => item.stat.isDirectory())
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

          if (dirs.length > 0) {
            const latestDir = dirs[0];
            logError('Found latest directory: ' + latestDir.name);

            // Find the summary file with the full name pattern
            const files = readdirSync(latestDir.path);
            const summaryFile = files.find(f => f.endsWith('_summary.json'));
            const metadataFile = files.find(f => f.endsWith('_metadata.json'));

            if (summaryFile) {
              const summaryPath = join(latestDir.path, summaryFile);
              const summaryData = JSON.parse(readFileSync(summaryPath, 'utf8'));
              
              // Also try to get metadata
              let metadata = {};
              if (metadataFile) {
                const metadataPath = join(latestDir.path, metadataFile);
                metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
              }
              
              sendMessage({
                success: true,
                summary: summaryData,
                metadata: metadata
              });
            } else {
              logError('No summary file found. Files in directory: ' + files.join(', '));
              sendMessage({ error: 'Summary file not found' });
            }
          } else {
            sendMessage({ error: 'No YTS output directory found' });
          }
        } catch (e) {
          logError('Error parsing YTS output: ' + e.message);
          sendMessage({ error: 'Failed to parse YTS output: ' + e.message });
        }
      } else {
        sendMessage({ 
          error: 'YTS process failed',
          code: code,
          stderr: errorData 
        });
      }
    });
    
    yts.on('error', (err) => {
      logError('Failed to start YTS: ' + err.message);
      sendMessage({ error: 'Failed to start YTS: ' + err.message });
    });
    
  } else {
    sendMessage({ error: 'Unknown action or missing URL' });
  }
});

// Handle stdin close
process.stdin.on('end', () => {
  process.exit();
});

// Handle errors
process.on('uncaughtException', (err) => {
  logError('Uncaught exception: ' + err.message);
  sendMessage({ error: 'Native host error: ' + err.message });
});