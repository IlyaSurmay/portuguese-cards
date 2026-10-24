import { APP_ORIGIN } from '../server/reminder-core.mjs'
import { queue } from '../server/reminder-services.mjs'

export default queue.handleNodeCallback(async message => {
  // Queue consumers stay with the deployment that published each message.
  // Forward to the current app so the following day is scheduled by current code.
  const response = await fetch(`${APP_ORIGIN}/api/deliver-reminder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
    body: JSON.stringify(message), signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw new Error(`Reminder delivery returned ${response.status}`)
}, {
  visibilityTimeoutSeconds: 60,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(3600, 60 * 2 ** Math.min(metadata.deliveryCount, 6)) }),
})
