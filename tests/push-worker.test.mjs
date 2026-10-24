import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

function worker(windows = []) {
  const events = {}, notifications = [], opened = []
  const context = vm.createContext({ URL, self: {
    location: { origin: 'https://portuguese-cards.vercel.app' },
    addEventListener: (name, callback) => { events[name] = callback },
    registration: { showNotification: async (...args) => { notifications.push(args) } },
    clients: { matchAll: async () => windows, openWindow: async url => { opened.push(url) } },
  } })
  vm.runInContext(readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8'), context)
  return { events, notifications, opened }
}

test('push displays a localized notification with stable tag and a safe app destination', async () => {
  const w = worker(); let work
  w.events.push({ data: { json: () => ({ body: 'Пора повторить карточки.', url: 'https://attacker.test', tag: 'arbitrary' }) }, waitUntil: value => { work = value } })
  await work
  const [title, options] = w.notifications[0]
  assert.equal(title, 'Portuguese Cards')
  assert.equal(options.body, 'Пора повторить карточки.')
  assert.equal(options.tag, 'portuguese-cards-daily')
  assert.equal(options.renotify, false)
  assert.equal(options.data.url, '/')
  w.events.push({ data: { json: () => { throw new Error('Invalid JSON') } }, waitUntil: value => { work = value } })
  await work; assert.ok(w.notifications[1][1].body)
})

test('tapping a notification returns an existing app window to the cards', async () => {
  let destination, focused = false, closed = false, work
  const client = { url: 'https://portuguese-cards.vercel.app/?view=settings', navigate: async url => { destination = url; return client }, focus: async () => { focused = true } }
  const w = worker([client])
  w.events.notificationclick({ notification: { close: () => { closed = true }, data: { url: 'https://attacker.test' } }, waitUntil: value => { work = value } })
  await work
  assert.ok(closed && focused)
  assert.equal(destination, 'https://portuguese-cards.vercel.app/')
  assert.equal(w.opened.length, 0)
})

test('tapping a notification can open a closed app or recover from a failed focus', async () => {
  for (const clients of [[], [{ url: 'https://portuguese-cards.vercel.app/', navigate: async () => { throw new Error('Closed') } }]]) {
    const w = worker(clients); let work
    w.events.notificationclick({ notification: { close() {} }, waitUntil: value => { work = value } }); await work
    assert.deepEqual(w.opened, ['https://portuguese-cards.vercel.app/'])
  }
})

test('API responses are never substituted with the offline app shell', () => {
  const w = worker(); let intercepted = false
  w.events.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://portuguese-cards.vercel.app/api/reminders' }, respondWith() { intercepted = true } })
  assert.equal(intercepted, false)
})
