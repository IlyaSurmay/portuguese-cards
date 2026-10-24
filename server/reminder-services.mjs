import { get, put } from '@vercel/blob'
import { QueueClient } from '@vercel/queue'
import webpush from 'web-push'
import { APP_ORIGIN, createReminderService } from './reminder-core.mjs'

// Unpinned jobs follow the current production deployment across app updates.
export const queue = new QueueClient({ region: 'iad1', deploymentId: null })
const pathname = id => `reminders/${id}.json`
const store = {
  async read(id) {
    const response = await get(pathname(id), { access: 'private', useCache: false })
    if (!response) return null
    return { value: await new Response(response.stream).json(), etag: response.blob.etag }
  },
  async write(id, value, etag) {
    const blob = await put(pathname(id), JSON.stringify(value), {
      access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag, allowOverwrite: true } : { allowOverwrite: false }),
    })
    return { etag: blob.etag }
  },
}
export function configured() {
  return Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY
    && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID))
}
export const reminders = createReminderService({
  store,
  enqueue: (message, options) => queue.send('study-reminders', message, options),
  push: (subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: APP_ORIGIN, publicKey: process.env.WEB_PUSH_PUBLIC_KEY, privateKey: process.env.WEB_PUSH_PRIVATE_KEY },
    TTL: 60 * 60 * 3, urgency: 'normal', timeout: 10000,
  }),
})
