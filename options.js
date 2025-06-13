// Saves options to chrome.storage
function saveOptions() {
  const apiKey = document.getElementById('apiKey').value;
  const readwiseToken = document.getElementById('readwiseToken').value;
  const enableReadwise = document.getElementById('enableReadwise').checked;
  
  chrome.storage.sync.set(
    { 
      apiKey: apiKey,
      readwiseToken: readwiseToken,
      enableReadwise: enableReadwise
    },
    function() {
      // Update status to let user know options were saved
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      status.className = 'status success';
      status.style.display = 'block';
      
      // Hide status after 2 seconds
      setTimeout(function() {
        status.style.display = 'none';
      }, 2000);
    }
  );
}

// Restores options from chrome.storage
function restoreOptions() {
  chrome.storage.sync.get(
    { 
      apiKey: '',
      readwiseToken: '',
      enableReadwise: false
    },
    function(items) {
      document.getElementById('apiKey').value = items.apiKey;
      document.getElementById('readwiseToken').value = items.readwiseToken;
      document.getElementById('enableReadwise').checked = items.enableReadwise;
    }
  );
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);