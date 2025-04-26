chrome.action.onClicked.addListener((tab) => {
  // Send message directly to the content script
  chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
});
