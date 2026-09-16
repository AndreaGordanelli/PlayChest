(() => {
  const storageKey = 'gamecacheTheme';

  function getPreferredTheme() {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.getElementById('themeColorMeta');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#0f1419' : '#b71c1c');
    }
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
    }
  }

  function setupThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(storageKey, nextTheme);
      applyTheme(nextTheme);
    });
  }

  function setupOfflineBanner() {
    const update = () => {
      document.documentElement.classList.toggle('is-offline', !navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.warn('Service worker registration failed.', error);
      });
    });
  }

  applyTheme(getPreferredTheme());

  const startUi = () => {
    setupThemeToggle();
    setupOfflineBanner();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUi);
  } else {
    startUi();
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => {
    if (localStorage.getItem(storageKey)) return;
    applyTheme(event.matches ? 'dark' : 'light');
  });

  registerServiceWorker();
})();
