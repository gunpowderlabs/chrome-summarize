// Saves options to chrome.storage
function saveOptions() {
  const gatewayApiKey = document.getElementById('gatewayApiKey').value.trim();
  const readwiseToken = document.getElementById('readwiseToken').value;
  const enableReadwise = document.getElementById('enableReadwise').checked;
  
  chrome.storage.sync.set(
    { 
      gatewayApiKey: gatewayApiKey,
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
      gatewayApiKey: '',
      readwiseToken: '',
      enableReadwise: false
    },
    function(items) {
      document.getElementById('gatewayApiKey').value = items.gatewayApiKey;
      document.getElementById('readwiseToken').value = items.readwiseToken;
      document.getElementById('enableReadwise').checked = items.enableReadwise;
    }
  );
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
