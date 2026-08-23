const CACHE_NAME = 'qiguang-shell-v0.6.9';
const CORE = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法缓存应用入口。');
    const html = await response.text();
    await cache.put('/', new Response(html, { headers: response.headers }));
    const assets = [...html.matchAll(/(?:src|href)="(\/(?!api\/)[^"]+)"/g)].map((match) => match[1]);
    const bundles = assets.filter((asset) => asset.endsWith('.js'));
    const bundleText = await Promise.all(bundles.map(async (bundle) => {
      const bundleResponse = await fetch(bundle, { cache: 'no-store' });
      if (!bundleResponse.ok) throw new Error(`无法缓存应用资源：${bundle}`);
      return bundleResponse.text();
    }));
    const images = bundleText.flatMap((text) => [...text.matchAll(/["'`](\/assets\/[^"'`]+\.(?:png|jpe?g))["'`]/g)].map((match) => match[1]));
    await cache.addAll([...new Set([...CORE.slice(1), ...assets, ...images])]);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('qiguang-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === 'navigate') return (await cache.match('/')) ?? fetch(event.request);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok && response.type === 'basic') await cache.put(event.request, response.clone());
    return response;
  })());
});
