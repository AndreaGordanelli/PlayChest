async function fetchStatus() {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

async function refreshStatus() {
  try {
    const status = await fetchStatus();
    setText('admin-db-ready', status.databaseReady ? 'Yes' : 'No');
    setText('admin-sync-status', status.syncRunning ? 'Running' : (status.status || 'Unknown'));
    setText('admin-game-count', status.gameCount ?? '-');
    setText('admin-updated-at', status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '-');

    const errorBox = document.getElementById('admin-error');
    if (status.error) {
      errorBox.hidden = false;
      errorBox.textContent = status.error;
    } else {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
  } catch (error) {
    setText('admin-sync-status', 'Unavailable');
    document.getElementById('admin-error').hidden = false;
    document.getElementById('admin-error').textContent = error.message;
  }
}

async function runSync() {
  const button = document.getElementById('admin-sync-btn');
  button.disabled = true;
  button.textContent = 'Starting sync...';
  try {
    const response = await fetch('/api/sync', { method: 'POST' });
    if (!response.ok && response.status !== 202) {
      throw new Error(`Sync request failed (${response.status})`);
    }
    button.textContent = 'Sync running...';
    const poll = setInterval(async () => {
      await refreshStatus();
      const status = await fetchStatus();
      if (!status.syncRunning) {
        clearInterval(poll);
        button.disabled = false;
        button.textContent = 'Run sync now';
      }
    }, 3000);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Run sync now';
    document.getElementById('admin-error').hidden = false;
    document.getElementById('admin-error').textContent = error.message;
  }
}

document.getElementById('admin-sync-btn').addEventListener('click', runSync);
refreshStatus();
setInterval(refreshStatus, 10000);
