const cacheVersion = 'gamecache-v1';
const shellCacheName = `${cacheVersion}-shell`;
const dataCacheName = `${cacheVersion}-data`;
const imageCacheName = `${cacheVersion}-images`;

const appShell = [
  './',
  './index.html',
  './style.css',
  './app-sqlite.js',
  './features.js',
  './theme.js',
  './admin.html',
  './admin.js',
  './manifest.webmanifest',
  './config.ini',
  './favicon.ico',
  './vendor/sql-wasm.js',
  './vendor/sql-wasm.wasm',
  './vendor/fflate.js',
  './icons/meeple.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

async function precache(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        await cache.put(url, response);
      }
    } catch (error) {
      console.warn('Failed to precache', url, error);
    }
  }));
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || networkPromise;
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname === '/health'
    || url.pathname === '/ready';
}

function isDatabaseRequest(url) {
  return url.pathname.endsWith('.sqlite.gz');
}

function isImageRequest(request, url) {
  return request.destination === 'image'
    || /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(url.pathname);
}

function isStaticCdnRequest(url) {
  return url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
    || url.hostname.endsWith('geekdo-images.com')
    || url.hostname.endsWith('geekdo.com');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precache(shellCacheName, appShell);
    await precache(dataCacheName, ['./gamecache.sqlite.gz']);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => !key.startsWith(cacheVersion))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(shellCacheName);
        cache.put(request, response.clone());
        return response;
      } catch (error) {
        const offlinePage = url.pathname.endsWith('admin.html')
          ? './admin.html'
          : './index.html';
        return await caches.match(offlinePage)
          || await caches.match('./index.html')
          || await caches.match('./');
      }
    })());
    return;
  }

  if (isDatabaseRequest(url)) {
    event.respondWith(networkFirst(request, dataCacheName));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (isImageRequest(request, url) || isStaticCdnRequest(url) || request.destination === 'font' || request.destination === 'style') {
      event.respondWith(cacheFirst(request, imageCacheName));
    }
    return;
  }

  event.respondWith(staleWhileRevalidate(request, shellCacheName));
});
