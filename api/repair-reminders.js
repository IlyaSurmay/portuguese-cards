import { repairSchedules } from '../server/reminder-services.mjs'
import { internalAuthorized } from '../server/reminder-internal.mjs'

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (!internalAuthorized(request, process.env.CRON_SECRET)) return response.status(401).json({ code: 'unauthorized' })
  if (request.method !== 'GET') return response.status(405).json({ code: 'methodNotAllowed' })
  try { await repairSchedules(); return response.status(200).json({ ok: true }) }
  catch (error) {
    console.error('Reminder recovery failed:', error.name)
    return response.status(503).json({ code: 'recoveryFailed' })
  }
}
