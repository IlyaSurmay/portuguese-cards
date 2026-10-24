import { APP_ORIGIN, ReminderError } from './reminder-core.mjs'

export function createReminderHandler({ reminders, configured, publicKey, origin = APP_ORIGIN, logError = console.error }) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Vary', 'Origin')
    if (!configured()) return response.status(503).json({ code: 'notConfigured' })
    if (request.method === 'GET') return response.status(200).json({ publicKey: publicKey() })
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST')
      return response.status(405).json({ code: 'methodNotAllowed' })
    }
    if (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site') return response.status(403).json({ code: 'forbidden' })
    if (!request.headers['content-type']?.startsWith('application/json')) return response.status(415).json({ code: 'invalidBody' })
    if (Number(request.headers['content-length']) > 8192) return response.status(413).json({ code: 'invalidBody' })
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
      if (!body || JSON.stringify(body).length > 8192) throw new ReminderError('invalidBody')
      const { action, id, ...input } = body
      const token = request.headers.authorization?.replace(/^Bearer /, '')
      let result
      if (action === 'status') result = await reminders.status(id, token)
      else if (action === 'save') result = await reminders.save(id, token, input)
      else if (action === 'disable') result = await reminders.disable(id, token)
      else if (action === 'test') result = await reminders.test(id, token)
      else throw new ReminderError('invalidAction')
      return response.status(200).json(result)
    } catch (error) {
      if (error instanceof ReminderError) return response.status(error.status).json({ code: error.code })
      if (error instanceof SyntaxError) return response.status(400).json({ code: 'invalidBody' })
      if (error.name === 'BlobPreconditionFailedError') return response.status(409).json({ code: 'conflict' })
      // Never log tokens, subscription endpoints or encrypted payload keys.
      logError('Reminder request failed:', error.name)
      return response.status(503).json({ code: 'serviceUnavailable' })
    }
  }
}
