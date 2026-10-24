import { get, put, list } from '@vercel/blob'
import { QueueClient } from '@vercel/queue'
import webpush from 'web-push'
import { APP_ORIGIN, createReminderService } from './reminder-core.mjs'

// Push-mode jobs require the publishing deployment's consumer registration.
export const queue = new QueueClient({ region: 'iad1' })
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
  return Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY && process.env.CRON_SECRET
    && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID))
}
export const reminders = createReminderService({
  store,
  enqueue: (message, options) => queue.send('study-reminders', message, { ...options,
    idempotencyKey: `${options.idempotencyKey}:${process.env.VERCEL_DEPLOYMENT_ID}`,
  }),
  push: (subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: APP_ORIGIN, publicKey: process.env.WEB_PUSH_PUBLIC_KEY, privateKey: process.env.WEB_PUSH_PRIVATE_KEY },
    TTL: 60 * 60 * 3, urgency: 'normal', timeout: 10000,
  }),
})

export async function repairSchedules() {
  let cursor
  do {
    const page = await list({ prefix: 'reminders/', limit: 100, ...(cursor ? { cursor } : {}) })
    for (let start = 0; start < page.blobs.length; start += 10) {
      const results = await Promise.allSettled(page.blobs.slice(start, start + 10).map(blob => {
        const id = /^reminders\/([\w-]{43})\.json$/.exec(blob.pathname)?.[1]
        return id ? reminders.repair(id) : Promise.resolve()
      }))
      if (results.some(result => result.status === 'rejected')) throw new Error('Schedule repair failed')
    }
    cursor = page.hasMore ? page.cursor : null
  } while (cursor)
}
