const cacheName = 'budsync-shell-v11'
const shellFiles = [
  '/', '/index.html', '/welcome', '/manifest.webmanifest',
  '/Budsync_Light_Icon_Transparent.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    const response = await fetch('/index.html', { cache: 'reload' })
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1])
    await cache.addAll([...shellFiles, ...assets])
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('budsync-shell-') && key !== cacheName).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request)
        const cache = await caches.open(cacheName)
        cache.put('/index.html', response.clone())
        return response
      } catch {
        return (await caches.match('/index.html')) || Response.error()
      }
    })())
    return
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    if (cached) return cached
    const response = await fetch(event.request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(event.request, response.clone())
    }
    return response
  })())
})
