const fetchOptions = { cache: 'no-store', credentials: 'same-origin' };
const adminTokenKey = 'playChestAdminToken';

function adminHeaders(extra = {}) {
  const headers = { ...extra };
  const token = sessionStorage.getItem(adminTokenKey);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...fetchOptions,
    ...options,
    headers: adminHeaders(options.headers || {}),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (response.status === 401) {
    sessionStorage.removeItem(adminTokenKey);
    showLogin();
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function fetchStatus() {
  return fetchJson('/api/status');
}

async function fetchUsernames() {
  return fetchJson('/api/usernames');
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function showAdminError(message) {
  const errorBox = document.getElementById('admin-error');
  if (!errorBox) return;
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function hideAdminError() {
  const errorBox = document.getElementById('admin-error');
  if (!errorBox) return;
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function showLoginError(message) {
  const errorBox = document.getElementById('adminLoginError');
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function hideLoginError() {
  const errorBox = document.getElementById('adminLoginError');
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function showLogin() {
  document.getElementById('adminLoginCard').hidden = false;
  document.getElementById('adminApp').hidden = true;
  document.getElementById('adminLogoutBtn').hidden = true;
}

function showAdminApp() {
  document.getElementById('adminLoginCard').hidden = true;
  document.getElementById('adminApp').hidden = false;
  document.getElementById('adminLogoutBtn').hidden = false;
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
    await fetchJson('/api/sync', { method: 'POST' });
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
    await fetchJson('/api/usernames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
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
  await fetchJson(`/api/usernames?username=${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
  await refreshUsernames();
  await runSync();
}

async function loginAdmin(event) {
  event.preventDefault();
  const input = document.getElementById('adminPasswordInput');
  const button = document.getElementById('adminLoginBtn');
  const password = input.value;
  if (!password) return;
  button.disabled = true;
  hideLoginError();
  try {
    const payload = await fetchJson('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (payload.sessionToken) {
      sessionStorage.setItem(adminTokenKey, payload.sessionToken);
    }
    input.value = '';
    await enterAdmin();
  } catch (error) {
    showLoginError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function logoutAdmin() {
  try {
    await fetchJson('/api/admin/logout', { method: 'POST' });
  } catch (error) {
    // still return to the login screen
  }
  sessionStorage.removeItem(adminTokenKey);
  showLogin();
}

let statusTimer = null;
let usernamesTimer = null;

async function enterAdmin() {
  showAdminApp();
  await refreshStatus();
  await refreshUsernames();
  if (statusTimer) clearInterval(statusTimer);
  if (usernamesTimer) clearInterval(usernamesTimer);
  statusTimer = setInterval(refreshStatus, 10000);
  usernamesTimer = setInterval(refreshUsernames, 10000);
}

async function initAdmin() {
  try {
    const session = await fetchJson('/api/admin/session');
    if (!session.passwordConfigured) {
      showLogin();
      document.getElementById('adminLoginForm').hidden = true;
      document.getElementById('adminLoginHelp').textContent =
        'Set GAMECACHE_ADMIN_PASSWORD in your .env file and restart Docker.';
      return;
    }
    if (session.authenticated) {
      await enterAdmin();
      return;
    }
    showLogin();
  } catch (error) {
    showLogin();
    showLoginError(error.message);
  }
}

document.getElementById('adminLoginForm').addEventListener('submit', loginAdmin);
document.getElementById('adminLogoutBtn').addEventListener('click', logoutAdmin);
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
initAdmin();
