import test from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { createReminderService, nextReminderAt, notificationPayload, validatePreferences, validateSubscription } from '../server/reminder-core.mjs'
import { createReminderHandler } from '../server/reminder-http.mjs'

const id = 'a'.repeat(43), token = 'b'.repeat(43)
const key = createECDH('prime256v1'); key.generateKeys()
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
const preferences = { subscription, time: '19:00', timeZone: 'Europe/Lisbon', language: 'ru' }
function fixture() {
  const values = new Map(), jobs = [], pushes = []
  let timestamp = Date.UTC(2026, 9, 24, 10), version = 0, failEnqueue = false, failPush = null, pausePush = null
  const store = {
    async read(key) { return values.has(key) ? structuredClone(values.get(key)) : null },
    async write(key, value, etag) {
      assert.equal(values.get(key)?.etag, etag, 'conditional write must match the last read')
      const record = { value: structuredClone(value), etag: String(++version) }; values.set(key, record); return { etag: record.etag }
    },
  }
  const service = createReminderService({ store, now: () => timestamp,
    enqueue: async (message, options) => { if (failEnqueue) throw new Error('Queue unavailable'); jobs.push({ message, options }) },
    push: async (sub, payload) => { if (failPush) throw failPush; pushes.push({ sub, payload }); if (pausePush) await pausePush },
  })
  return { service, values, jobs, pushes,
    advance: value => { timestamp = value }, failEnqueue: value => { failEnqueue = value }, failPush: value => { failPush = value }, pausePush: value => { pausePush = value } }
}

test('daily reminders retain wall-clock time across 23- and 25-hour DST days', () => {
  assert.equal(nextReminderAt('09:00', 'Europe/Lisbon', Date.UTC(2026, 2, 28, 9)), Date.UTC(2026, 2, 29, 8))
  assert.equal(nextReminderAt('09:00', 'Europe/Lisbon', Date.UTC(2026, 9, 24, 8)), Date.UTC(2026, 9, 25, 9))
  assert.equal(nextReminderAt('01:30', 'Europe/Lisbon', Date.UTC(2026, 2, 29, 0)), Date.UTC(2026, 2, 29, 1, 30))
  assert.equal(nextReminderAt('01:30', 'Europe/Lisbon', Date.UTC(2026, 9, 25, 0, 40)), Date.UTC(2026, 9, 26, 1, 30))
  assert.equal(nextReminderAt('19:00', 'Asia/Kathmandu', Date.UTC(2026, 9, 24, 0)), Date.UTC(2026, 9, 24, 13, 15))
})

test('subscription validation rejects arbitrary URLs, credentials, and invalid encryption keys', () => {
  assert.deepEqual(validateSubscription(subscription), subscription)
  assert.deepEqual(validateSubscription({ ...subscription, keys: { p256dh: subscription.keys.p256dh+'=', auth: subscription.keys.auth+'==' } }), subscription)
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.attacker.test/x', 'https://a:b@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x']) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }))
  }
  assert.throws(() => validateSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: 'x'.repeat(87) } }))
  for (const input of [{ ...preferences, time: '25:00' }, { ...preferences, timeZone: 'Not/AZone' }, { ...preferences, language: 'en' }]) assert.throws(() => validatePreferences(input))
})

test('enabling queues a durable job; duplicate delivery sends once and schedules tomorrow', async () => {
  const f = fixture()
  const saved = await f.service.save(id, token, preferences)
  assert.equal(saved.enabled, true)
  assert.equal(saved.nextDueAt, Date.UTC(2026, 9, 24, 18))
  assert.equal(f.jobs[0].options.delaySeconds, 8 * 3600)
  assert.equal(f.jobs[0].options.retentionSeconds, 604800)
  assert.deepEqual(Object.keys(f.jobs[0].message).sort(), ['dueAt', 'id', 'revision'])
  assert.equal('progress' in f.values.get(id).value, false)
  const job = f.jobs[0].message
  f.advance(job.dueAt)
  await f.service.deliver(job); await f.service.deliver(job)
  assert.equal(f.pushes.length, 1)
  assert.equal(f.pushes[0].payload.body, notificationPayload('ru').body)
  assert.equal(f.values.get(id).value.nextDueAt, Date.UTC(2026, 9, 25, 19))
})

test('only the owning device can inspect, change, test, or disable its subscription', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  for (const action of ['status', 'disable', 'test']) await assert.rejects(f.service[action](id, 'c'.repeat(43)), { code: 'forbidden' })
  await assert.rejects(f.service.save(id, 'c'.repeat(43), preferences), { code: 'forbidden' })
  assert.equal((await f.service.status(id, token)).enabled, true)
})

test('changing time invalidates old jobs; disabling prevents queued reminders', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  const old = f.jobs[0].message
  await f.service.save(id, token, { ...preferences, time: '20:00' })
  f.advance(old.dueAt); await f.service.deliver(old); assert.equal(f.pushes.length, 0)
  await f.service.disable(id, token)
  const latest = f.jobs.at(-1).message; f.advance(latest.dueAt); await f.service.deliver(latest)
  assert.equal(f.pushes.length, 0); assert.equal(f.values.get(id).value.subscription, null)
})

test('a failed enqueue can be repaired by retrying save without resetting the schedule', async () => {
  const f = fixture(); f.failEnqueue(true)
  await assert.rejects(f.service.save(id, token, preferences))
  const revision = f.values.get(id).value.revision
  f.failEnqueue(false); await f.service.save(id, token, preferences)
  assert.equal(f.jobs[0].message.revision, revision)
})

test('push retries repair a failed enqueue without repeating an accepted notification', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  const job = f.jobs[0].message; f.advance(job.dueAt); f.failEnqueue(true)
  await assert.rejects(f.service.deliver(job)); assert.equal(f.pushes.length, 1)
  f.failEnqueue(false); await f.service.deliver(job)
  assert.equal(f.pushes.length, 1); assert.ok(f.jobs.at(-1).message.dueAt > job.dueAt)
})

test('revoked subscriptions stop automatically; transient failures remain retryable', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  const job = f.jobs[0].message; f.advance(job.dueAt)
  f.failPush(Object.assign(new Error('Unavailable'), { statusCode: 503 }))
  await assert.rejects(f.service.deliver(job))
  assert.equal(f.values.get(id).value.enabled, true); assert.equal(f.values.get(id).value.lease, null)
  f.failPush(Object.assign(new Error('Gone'), { statusCode: 410 })); await f.service.deliver(job)
  assert.equal(f.values.get(id).value.enabled, false); assert.equal(f.values.get(id).value.subscription, null)
})

test('late jobs skip yesterday and a time change cannot send twice on the same local day', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  f.advance(f.jobs[0].message.dueAt + 24 * 3600000); await f.service.deliver(f.jobs[0].message)
  assert.equal(f.pushes.length, 0)
  const next = f.jobs.at(-1).message; f.advance(next.dueAt); await f.service.deliver(next)
  await f.service.save(id, token, { ...preferences, time: '20:00' })
  const changed = f.jobs.at(-1).message; f.advance(changed.dueAt); await f.service.deliver(changed)
  assert.equal(f.pushes.length, 1)
})

test('settings changed during a send survive and preserve the daily delivery receipt', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  const job = f.jobs[0].message; f.advance(job.dueAt)
  let resolve; f.pausePush(new Promise(r => { resolve = r }))
  const sending = f.service.deliver(job)
  while (!f.pushes.length) await new Promise(r => setImmediate(r))
  await f.service.save(id, token, { ...preferences, time: '20:00' })
  resolve(); await sending; f.pausePush(null)
  assert.equal(f.values.get(id).value.time, '20:00')
  assert.equal(f.values.get(id).value.lastSentAt, job.dueAt)
  const next = f.jobs.at(-1).message; f.advance(next.dueAt); await f.service.deliver(next)
  assert.equal(f.pushes.length, 1)
})

test('test notifications are rate-limited and do not replace the daily schedule', async () => {
  const f = fixture(); await f.service.save(id, token, preferences)
  const due = f.values.get(id).value.nextDueAt
  await f.service.test(id, token)
  assert.equal(f.pushes[0].payload.tag, 'portuguese-cards-test')
  assert.equal(f.values.get(id).value.nextDueAt, due)
  await assert.rejects(f.service.test(id, token), { code: 'testLimited', status: 429 })
})

test('HTTP boundary requires same-origin JSON and never returns management secrets', async () => {
  const f = fixture()
  const handler = createReminderHandler({ reminders: f.service, configured: () => true, publicKey: () => 'public' })
  async function request(method, headers = {}, body) {
    const response = { headers: {}, setHeader(k,v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, json(body) { this.body = body; return this } }
    await handler({ method, headers, body }, response); return response
  }
  assert.deepEqual((await request('GET')).body, { publicKey: 'public' })
  const headers = { origin: 'https://portuguese-cards.vercel.app', 'content-type': 'application/json', authorization: `Bearer ${token}` }
  assert.equal((await request('POST', { ...headers, origin: 'https://other.test' }, {})).statusCode, 403)
  assert.equal((await request('POST', { ...headers, 'content-type': 'text/plain' }, {})).statusCode, 415)
  assert.equal((await request('POST', { ...headers, 'content-length': '10000' }, {})).statusCode, 413)
  assert.equal((await request('POST', headers, '{broken')).statusCode, 400)
  const result = await request('POST', headers, { action: 'save', id, ...preferences })
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'no-store')
  for (const secret of ['token','secretHash','subscription','endpoint']) assert.equal(secret in result.body, false)
})
