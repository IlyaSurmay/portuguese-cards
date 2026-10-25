import { createHash, ECDH, randomUUID, timingSafeEqual } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'

const HOUR = 60 * 60 * 1000
export const APP_ORIGIN = 'https://portuguese-cards.vercel.app'
export const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
export class ReminderError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

export function nextReminderAt(time, timeZone, after = Date.now()) {
  const now = Temporal.Instant.fromEpochMilliseconds(after).toZonedDateTimeISO(timeZone)
  const clock = Temporal.PlainTime.from(time)
  let day = now.toPlainDate()
  let next = day.toPlainDateTime(clock).toZonedDateTime(timeZone, { disambiguation: 'compatible' })
  if (next.epochMilliseconds <= after) {
    day = day.add({ days: 1 })
    next = day.toPlainDateTime(clock).toZonedDateTime(timeZone, { disambiguation: 'compatible' })
  }
  return next.epochMilliseconds
}
const localDay = (timestamp, zone) => Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(zone).toPlainDate().toString()
const hash = value => createHash('sha256').update(value).digest('hex')
const isOwner = (record, token) => timingSafeEqual(Buffer.from(record.secretHash, 'hex'), Buffer.from(hash(token), 'hex'))

export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new ReminderError('invalidSubscription')
  let url
  try { url = new URL(value.endpoint) } catch { throw new ReminderError('invalidSubscription') }
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname)
    || url.hostname.endsWith('.notify.windows.com')
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new ReminderError('invalidSubscription')
  const { p256dh, auth } = value.keys ?? {}
  if (typeof p256dh !== 'string' || !/^[\w-]{87}=?$/.test(p256dh) || typeof auth !== 'string' || !/^[\w-]{22}(==)?$/.test(auth)) throw new ReminderError('invalidSubscription')
  try { ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1') } catch { throw new ReminderError('invalidSubscription') }
  return { endpoint: url.href, keys: { p256dh: p256dh.replaceAll('=', ''), auth: auth.replaceAll('=', '') } }
}

export function validatePreferences({ time, timeZone, language }) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ReminderError('invalidTime')
  if (typeof timeZone !== 'string' || timeZone.length > 80) throw new ReminderError('invalidTimeZone')
  try { new Intl.DateTimeFormat('en', { timeZone }).format() } catch { throw new ReminderError('invalidTimeZone') }
  if (!['uk', 'ru', 'en'].includes(language)) throw new ReminderError('invalidLanguage')
  return { time, timeZone, language }
}

export function notificationPayload(language, test = false) {
  const body = language === 'en'
    ? test ? 'Reminders are working. Time for a few Portuguese cards!' : 'Time for a few Portuguese cards.'
    : language === 'ru'
    ? test ? 'Напоминания работают. Самое время повторить несколько карточек!' : 'Пора выучить несколько португальских фраз.'
    : test ? 'Нагадування працюють. Саме час повторити кілька карток!' : 'Час вивчити кілька португальських фраз.'
  return { title: 'Portuguese Cards', body, tag: test ? 'portuguese-cards-test' : 'portuguese-cards-daily', url: '/' }
}

const publicSettings = record => ({ enabled: record.enabled, time: record.time, timeZone: record.timeZone, language: record.language, nextDueAt: record.enabled ? record.nextDueAt : null })

// Storage uses conditional writes; the queue may redeliver a message after a crash.
export function createReminderService({ store, enqueue, push, now = Date.now, uuid = randomUUID }) {
  async function owned(id, token) {
    if (!ID_PATTERN.test(id ?? '') || !ID_PATTERN.test(token ?? '')) throw new ReminderError('invalidCredentials', 401)
    const current = await store.read(id)
    if (current && !isOwner(current.value, token)) throw new ReminderError('forbidden', 403)
    return current
  }
  async function schedule(record) {
    await enqueue({ id: record.id, revision: record.revision, dueAt: record.nextDueAt }, {
      delaySeconds: Math.max(1, Math.ceil((record.nextDueAt - now()) / 1000)),
      retentionSeconds: 7 * 24 * 60 * 60,
      idempotencyKey: `${record.id}:${record.revision}:${record.nextDueAt}`,
    })
  }
  async function disableRecord(current) {
    const record = { ...current.value, enabled: false, subscription: null, revision: uuid(), lease: null, updatedAt: now() }
    await store.write(record.id, record, current.etag)
    return publicSettings(record)
  }
  return {
    async repair(id) {
      if (!ID_PATTERN.test(id ?? '')) return
      const current = await store.read(id)
      if (current?.value.enabled) await schedule(current.value)
    },
    async status(id, token) {
      const current = await owned(id, token)
      if (current?.value.enabled) await schedule(current.value)
      return current ? publicSettings(current.value) : { enabled: false }
    },
    async save(id, token, input) {
      const current = await owned(id, token)
      const preferences = validatePreferences(input)
      const subscription = validateSubscription(input.subscription)
      const unchanged = current?.value.enabled && ['time', 'timeZone', 'language'].every(k => current.value[k] === preferences[k])
        && JSON.stringify(current.value.subscription) === JSON.stringify(subscription)
      if (unchanged) { await schedule(current.value); return publicSettings(current.value) }
      const record = {
        id, secretHash: hash(token), ...preferences, subscription, enabled: true,
        revision: uuid(), nextDueAt: nextReminderAt(preferences.time, preferences.timeZone, now()),
        lastSentAt: current?.value.lastSentAt ?? null, testSentAt: current?.value.testSentAt ?? null,
        lease: current?.value.lease ?? null, updatedAt: now(),
      }
      await store.write(id, record, current?.etag)
      // A failed enqueue stays visible to the client. Retrying the same save repairs it.
      await schedule(record)
      return publicSettings(record)
    },
    async disable(id, token) {
      const current = await owned(id, token)
      return current ? disableRecord(current) : { enabled: false }
    },
    async test(id, token) {
      const current = await owned(id, token)
      if (!current?.value.enabled) throw new ReminderError('notEnabled', 409)
      if (current.value.testSentAt && now() - current.value.testSentAt < 60000) throw new ReminderError('testLimited', 429)
      const record = { ...current.value, testSentAt: now() }
      await store.write(id, record, current.etag)
      try { await push(record.subscription, notificationPayload(record.language, true)) }
      catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          const latest = await store.read(id)
          if (latest?.value.revision === record.revision) await disableRecord(latest)
          throw new ReminderError('subscriptionExpired', 410)
        }
        throw error
      }
      return { sent: true }
    },
    async deliver(message) {
      const { id, revision, dueAt } = message ?? {}
      if (!ID_PATTERN.test(id ?? '') || typeof revision !== 'string' || !Number.isSafeInteger(dueAt)) return
      let current = await store.read(id)
      if (!current?.value.enabled || current.value.revision !== revision) return
      let record = current.value
      // Old duplicate jobs can repair the next enqueue, but never send again.
      if (record.nextDueAt !== dueAt) { await schedule(record); return }
      if (now() < dueAt) throw new ReminderError('notDue', 409)
      const today = localDay(now(), record.timeZone)
      const alreadySent = record.lastSentAt !== null && localDay(record.lastSentAt, record.timeZone) === today
      // Do not deliver yesterday's reminder after a long service outage.
      const stale = localDay(dueAt, record.timeZone) !== today || now() - dueAt > 6 * HOUR
      if (!alreadySent && !stale) {
        if (record.lease && record.lease.until > now()) throw new ReminderError('deliveryBusy', 409)
        const lease = { token: uuid(), until: now() + 60000 }
        record = { ...record, lease }
        await store.write(id, record, current.etag)
        try { await push(record.subscription, notificationPayload(record.language)) }
        catch (error) {
          current = await store.read(id)
          if (current?.value.revision !== revision) return
          if ([404, 410].includes(error.statusCode)) { await disableRecord(current); return }
          if (current.value.lease?.token === lease.token) await store.write(id, { ...current.value, lease: null }, current.etag)
          throw error
        }
        current = await store.read(id)
        if (current?.value.lease?.token !== lease.token) return
        // Preserve settings saved while the push service was accepting the message.
        record = { ...current.value, lease: null, lastSentAt: now() }
        await store.write(id, record, current.etag)
        if (record.revision !== revision) return
      }
      current = await store.read(id)
      if (!current?.value.enabled || current.value.revision !== revision) return
      record = { ...current.value, lease: null, nextDueAt: nextReminderAt(current.value.time, current.value.timeZone, now()), updatedAt: now() }
      await store.write(id, record, current.etag)
      await schedule(record)
    },
  }
}
