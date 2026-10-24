import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { AUDIO_CACHE, downloadAudio } from '../src/offline.js'

function cacheStorage() {
  const stores = new Map()
  const key = request => typeof request === 'string' ? new URL(request, 'https://app.test').href : request.url
  return {
    stores,
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const items = stores.get(name)
      return {
        keys: async () => [...items.keys()].map(url => new Request(url)),
        match: async request => items.get(key(request))?.clone(),
        put: async (request, response) => { items.set(key(request), response.clone()) },
        addAll: async urls => { for (const url of urls) items.set(key(url), new Response(typeof url === 'string' ? url : new URL(url.url).pathname)) },
      }
    },
  }
}
function worker() {
  const cache = cacheStorage()
  const events = {}
  const context = vm.createContext({
    caches: cache, Response, Request, URL, Number,
    fetch: async () => { throw new Error('Offline') },
    self: { location: { origin: 'https://app.test' }, clients: { claim: async () => {} },
      addEventListener: (name, callback) => { events[name] = callback }, skipWaiting() {} },
  })
  const source = readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8')
    .replace('__BUILD__', 'test').replace('/* inject:precache */ []', JSON.stringify(['/index.html', '/assets/app.js']))
  vm.runInContext(source, context)
  return { cache, context, events }
}

test('an installed shell can launch offline, and updates remove only obsolete shell caches', async () => {
  const { cache, events } = worker()
  let work
  events.install({ waitUntil: value => { work = value } })
  await work
  await cache.open('portuguese-cards-shell-old')
  await cache.open(AUDIO_CACHE)
  await cache.open('unrelated-cache')
  events.activate({ waitUntil: value => { work = value } })
  await work
  assert.deepEqual((await cache.keys()).sort(), [AUDIO_CACHE, 'portuguese-cards-shell-test', 'unrelated-cache'].sort())
  let response
  events.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://app.test/' }, respondWith: value => { response = value } })
  assert.equal(await (await response).text(), '/index.html')
})

test('cached audio supports Safari-style prefix, suffix, open-ended and invalid byte ranges offline', async () => {
  const { cache, events } = worker()
  const url = 'https://static.wixstatic.com/mp3/sample.mp3'
  const recordings = await cache.open(AUDIO_CACHE)
  await recordings.put(url, new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), { headers: { 'Content-Type': 'audio/mpeg' } }))
  for (const [range, expected] of [['bytes=0-1', [0, 1]], ['bytes=3-', [3, 4, 5]], ['bytes=-2', [4, 5]]]) {
    let promise
    events.fetch({ request: new Request(url, { headers: { Range: range } }), respondWith: value => { promise = value } })
    const result = await promise
    assert.equal(result.status, 206)
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], expected)
  }
  let promise
  events.fetch({ request: new Request(url, { headers: { Range: 'bytes=100-' } }), respondWith: value => { promise = value } })
  assert.equal((await promise).status, 416)
})

test('audio downloads keep partial successes and resume without fetching them again', async () => {
  const originalCache = globalThis.caches, originalFetch = globalThis.fetch
  globalThis.caches = cacheStorage()
  const fetched = []
  const urls = [1, 2, 3, 4].map(i => `https://static.wixstatic.com/mp3/${i}.mp3`)
  globalThis.fetch = async url => {
    fetched.push(url)
    return new Response(url, { status: url === urls[1] ? 500 : 200, headers: { 'Content-Type': 'audio/mpeg' } })
  }
  try {
    const first = await downloadAudio(urls, { signal: new AbortController().signal, onProgress() {} })
    assert.equal(first.completed, 3)
    assert.equal(first.failed, 1)
    fetched.length = 0
    globalThis.fetch = async url => { fetched.push(url); return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }) }
    const second = await downloadAudio(urls, { signal: new AbortController().signal, onProgress() {} })
    assert.equal(second.completed, 4)
    assert.deepEqual(fetched, [urls[1]])
  } finally { globalThis.caches = originalCache; globalThis.fetch = originalFetch }
})

test('a cancelled audio download retains cached recordings for a later resume', async () => {
  const originalCache = globalThis.caches, originalFetch = globalThis.fetch
  globalThis.caches = cacheStorage()
  const controller = new AbortController()
  globalThis.fetch = async () => new Response('recording', { headers: { 'Content-Type': 'audio/mpeg' } })
  const urls = Array.from({ length: 20 }, (_, i) => `https://static.wixstatic.com/mp3/${i}.mp3`)
  try {
    const result = await downloadAudio(urls, { signal: controller.signal, onProgress(value) { if (value.completed >= 2) controller.abort() } })
    assert.equal(result.cancelled, true)
    assert.ok(result.completed >= 2 && result.completed < 20)
    const cached = await (await caches.open(AUDIO_CACHE)).keys()
    assert.equal(cached.length, result.completed)
  } finally { globalThis.caches = originalCache; globalThis.fetch = originalFetch }
})

test('revoked cache access falls back to the network instead of breaking online study', async () => {
  const { context, events } = worker()
  context.caches.open = async () => { throw new Error('Storage unavailable') }
  context.fetch = async () => new Response('online content')
  let promise
  events.fetch({ request: new Request('https://static.wixstatic.com/mp3/clip.mp3'), respondWith: value => { promise = value } })
  assert.equal(await (await promise).text(), 'online content')
  events.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://app.test/' }, respondWith: value => { promise = value } })
  assert.equal(await (await promise).text(), 'online content')
})
