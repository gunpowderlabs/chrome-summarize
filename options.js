// Saves options to chrome.storage
function saveOptions() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.sync.set(
    { apiKey: apiKey },
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

// Restores API key from chrome.storage
function restoreOptions() {
  chrome.storage.sync.get(
    { apiKey: '' },
    function(items) {
      document.getElementById('apiKey').value = items.apiKey;
    }
  );
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);