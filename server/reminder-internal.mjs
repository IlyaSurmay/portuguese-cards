import { createHash, timingSafeEqual } from 'node:crypto'

export function internalAuthorized(request, secret) {
  if (!secret || typeof request.headers.authorization !== 'string') return false
  const hash = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(request.headers.authorization), hash(`Bearer ${secret}`))
}

export function createDeliveryHandler({ authorized, deliver }) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (!authorized(request)) return response.status(401).json({ code: 'unauthorized' })
    if (request.method !== 'POST') return response.status(405).json({ code: 'methodNotAllowed' })
    try {
      if (Number(request.headers['content-length']) > 1024) return response.status(413).json({ code: 'invalidBody' })
      const message = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
      if (JSON.stringify(message ?? null).length > 1024) return response.status(413).json({ code: 'invalidBody' })
      await deliver(message)
      return response.status(200).json({ ok: true })
    } catch (error) {
      console.error('Daily reminder delivery failed:', error.name, error.statusCode ?? error.status ?? 'unknown')
      return response.status(503).json({ code: 'deliveryFailed' })
    }
  }
}
