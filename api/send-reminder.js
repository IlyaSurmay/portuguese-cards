import { queue, reminders } from '../server/reminder-services.mjs'

export default queue.handleNodeCallback(async message => {
  try { await reminders.deliver(message) }
  catch (error) {
    // Provider errors can contain a subscription endpoint; keep queue logs private.
    console.error('Daily reminder delivery failed:', error.name, error.statusCode ?? error.status ?? 'unknown')
    throw new Error('Daily reminder delivery failed')
  }
}, {
  visibilityTimeoutSeconds: 60,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(3600, 60 * 2 ** Math.min(metadata.deliveryCount, 6)) }),
})
