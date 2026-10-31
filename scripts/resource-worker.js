const scope = new URL(self.registration.scope);
const cachePrefix = `human-overdrive:${scope.pathname}:`;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

async function readCached(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch (error) {
    console.warn('无法读取资源缓存，将从网络加载', error);
  }
}

async function storeCached(request, response, cacheName, limit) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    const keys = await cache.keys();
    const pathname = new URL(request.url).pathname;
    const revisions = keys.filter(key => new URL(key.url).pathname === pathname);
    const expired = new Set([...revisions.slice(0, -2), ...keys.slice(0, -limit)]);
    await Promise.all([...expired].map(key => cache.delete(key)));
  } catch (error) {
    console.warn('无法保存资源缓存，本次加载继续使用网络资源', error);
  }
}

async function loadResource(event, bundled) {
  const cacheName = `${cachePrefix}${bundled ? 'bundles' : 'resources'}-v1`;
  const cached = await readCached(event.request, cacheName);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.status === 200 && !response.headers.get('Cache-Control')?.includes('no-store')) {
    event.waitUntil(storeCached(event.request, response.clone(), cacheName, bundled ? 8 : 128));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }
  if (request.headers.has('Range') || request.destination === 'audio' || request.destination === 'video') return;
  const path = url.pathname.slice(scope.pathname.length);
  const versionedPublic = /^(?:assets|data)\//.test(path) && /^[a-f0-9]{16}$/.test(url.searchParams.get('v') ?? '');
  const bundled = /^assets\/[^/]+-[\w-]{8,}\.(?:js|css|wasm)$/.test(path);
  if (versionedPublic || bundled) event.respondWith(loadResource(event, bundled));
});
