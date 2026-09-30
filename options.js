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

function showDiagnosticsStatus(message, success) {
  const status = document.getElementById('diagnosticsStatus');
  status.textContent = message;
  status.className = success ? 'status success' : 'status error';
  status.style.display = 'block';
}

async function getDiagnostics() {
  const response = await chrome.runtime.sendMessage({ action: 'getSummaryDiagnostics' });
  if (!response?.ok || !response.report) throw new Error('Unable to read saved diagnostics.');
  return response.report;
}

async function refreshDiagnostics() {
  const count = document.getElementById('diagnosticsCount');
  if (!count) return;
  try {
    const report = await getDiagnostics();
    count.textContent = `${report.records.length} saved events. Up to 50 recent events are kept, within a 1 MB limit.`;
  } catch {
    count.textContent = 'Unable to read saved diagnostics. Reload the extension and try again.';
  }
}

async function exportDiagnostics() {
  try {
    const report = await getDiagnostics();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `page-summarizer-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showDiagnosticsStatus('Diagnostics exported. You can share the JSON file to diagnose an issue.', true);
  } catch {
    showDiagnosticsStatus('Could not export diagnostics. Reload the extension and try again.', false);
  }
}

async function clearDiagnostics() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearSummaryDiagnostics' });
    if (!response?.ok) throw new Error('Unable to clear saved diagnostics.');
    await refreshDiagnostics();
    showDiagnosticsStatus('Saved diagnostics cleared.', true);
  } catch {
    showDiagnosticsStatus('Could not clear diagnostics. Please try again.', false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  void refreshDiagnostics();
});
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('exportDiagnostics')?.addEventListener('click', exportDiagnostics);
document.getElementById('clearDiagnostics')?.addEventListener('click', clearDiagnostics);
