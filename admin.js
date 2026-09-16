async function fetchStatus() {
  const response = await fetch('/api/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return response.json();
}

async function fetchUsernames() {
  const response = await fetch('/api/usernames', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Usernames request failed (${response.status})`);
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function showAdminError(message) {
  const errorBox = document.getElementById('admin-error');
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function hideAdminError() {
  const errorBox = document.getElementById('admin-error');
  errorBox.hidden = true;
  errorBox.textContent = '';
}

async function refreshStatus() {
  try {
    const status = await fetchStatus();
    setText('admin-db-ready', status.databaseReady ? 'Yes' : 'No');
    setText('admin-sync-status', status.syncRunning ? 'Running' : (status.status || 'Unknown'));
    setText('admin-game-count', status.gameCount ?? '-');
    setText('admin-updated-at', status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '-');

    if (status.error) {
      showAdminError(status.error);
    } else {
      hideAdminError();
    }
  } catch (error) {
    setText('admin-sync-status', 'Unavailable');
    showAdminError(error.message);
  }
}

async function refreshUsernames() {
  const list = document.getElementById('adminUsernameList');
  if (!list) return;
  try {
    const data = await fetchUsernames();
    if (!data.usernames.length) {
      list.innerHTML = '<li class="admin-username-item">No usernames configured</li>';
      return;
    }
    const canRemove = data.usernames.length > 1;
    list.innerHTML = data.usernames.map(username => {
      const fromConfig = data.configUsernames.some(
        name => name.toLowerCase() === username.toLowerCase()
      );
      const sourceLabel = fromConfig ? '<span>From config.ini</span>' : '';
      const removeButton = canRemove
        ? `<button type="button" class="secondary-btn" data-remove-username="${username}">Remove</button>`
        : '';
      return `<li class="admin-username-item"><strong>${username}</strong>${sourceLabel}${removeButton}</li>`;
    }).join('');
  } catch (error) {
    list.innerHTML = `<li class="admin-username-item">${error.message}</li>`;
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
        refreshUsernames();
      }
    }, 3000);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Run sync now';
    showAdminError(error.message);
  }
}

async function addUsername(event) {
  event.preventDefault();
  const input = document.getElementById('adminUsernameInput');
  const button = document.getElementById('admin-username-add-btn');
  const username = input.value.trim();
  if (!username) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/usernames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Add username failed (${response.status})`);
    }
    input.value = '';
    await refreshUsernames();
    await runSync();
  } catch (error) {
    showAdminError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function removeUsername(username) {
  const response = await fetch(`/api/usernames?username=${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Remove username failed (${response.status})`);
  }
  await refreshUsernames();
  await runSync();
}

document.getElementById('admin-sync-btn').addEventListener('click', runSync);
document.getElementById('adminUsernameForm').addEventListener('submit', addUsername);
document.getElementById('adminUsernameList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-username]');
  if (!button) return;
  try {
    const username = button.dataset.removeUsername;
    if (!window.confirm(`Remove ${username} and sync the collection without their games?`)) {
      return;
    }
    button.disabled = true;
    await removeUsername(username);
  } catch (error) {
    showAdminError(error.message);
  }
});
refreshStatus();
refreshUsernames();
setInterval(refreshStatus, 10000);
setInterval(refreshUsernames, 10000);
