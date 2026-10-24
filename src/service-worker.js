/* This file is emitted as sw.js by the Vite build, with a versioned asset list. */
const APP_CACHE = 'portuguese-cards-shell-__BUILD__'
const AUDIO_CACHE = 'portuguese-cards-audio-v1'
const PRECACHE = /* inject:precache */ []

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(PRECACHE.map(path => new Request(new URL(path, self.location.origin), { cache: 'reload' })))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('portuguese-cards-shell-') && key !== APP_CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', event => {
  let payload
  try { payload = event.data?.json() } catch { /* Still show a reminder for an unreadable payload. */ }
  event.waitUntil(self.registration.showNotification('Portuguese Cards', {
    body: typeof payload?.body === 'string' ? payload.body.slice(0, 240) : 'Час повторити кілька португальських фраз.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: payload?.tag === 'portuguese-cards-test' ? payload.tag : 'portuguese-cards-daily',
    renotify: false, data: { url: '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const url = new URL('/', self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      try { const navigated = await existing.navigate(url); await (navigated ?? existing).focus(); return } catch { /* Try opening the app instead. */ }
    }
    await self.clients.openWindow(url)
  })())
})

// Safari requests byte ranges for recordings. Serve ranges from full cached MP3s.
async function audioResponse(response, range) {
  if (!range) return response
  const bytes = await response.arrayBuffer()
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  let start, end
  if (match && (match[1] || match[2])) {
    start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]))
    end = match[1] && match[2] ? Number(match[2]) : bytes.byteLength - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.byteLength) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } })
  }
  end = Math.min(end, bytes.byteLength - 1)
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
    },
  })
}

async function getAudio(request) {
  let cache, response
  try {
    cache = await caches.open(AUDIO_CACHE)
    response = await cache.match(request.url)
  } catch { return fetch(request) }
  if (!response) {
    // The recording host allows CORS. Fetch complete files so offline range requests work.
    try {
      response = await fetch(request.url, { mode: 'cors', credentials: 'omit', signal: request.signal })
    } catch { return fetch(request) }
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return response
    try { await cache.put(request.url, response.clone()) } catch { /* Playback still works if storage is full. */ }
  }
  return audioResponse(response, request.headers.get('Range'))
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return
    if (request.mode === 'navigate') {
      // Keep each HTML shell paired with its precached assets until the user applies an update.
      event.respondWith(caches.open(APP_CACHE).then(async cache =>
        (await cache.match('/index.html')) || fetch(request)).catch(() => fetch(request)))
    } else if (PRECACHE.includes(url.pathname)) {
      event.respondWith(caches.open(APP_CACHE).then(async cache =>
        (await cache.match(request, { ignoreSearch: true })) || fetch(request)).catch(() => fetch(request)))
    }
  } else if (url.hostname === 'static.wixstatic.com' && url.pathname.startsWith('/mp3/')) {
    event.respondWith(getAudio(request))
  }
})
