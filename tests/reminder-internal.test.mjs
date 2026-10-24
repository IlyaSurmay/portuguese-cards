import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeliveryHandler, internalAuthorized } from '../server/reminder-internal.mjs'

test('internal delivery cannot be authorized without the server secret', () => {
  assert.equal(internalAuthorized({ headers: {} }, undefined), false)
  assert.equal(internalAuthorized({ headers: { authorization: 'Bearer undefined' } }, undefined), false)
  assert.equal(internalAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'secret'), false)
  assert.equal(internalAuthorized({ headers: { authorization: 'Bearer secret' } }, 'secret'), true)
})

test('the current deployment accepts only authorized, bounded delivery requests', async () => {
  const messages = []
  const handler = createDeliveryHandler({ authorized: request => internalAuthorized(request, 'secret'), deliver: async message => { messages.push(message) } })
  async function call(headers, body, method = 'POST') {
    const response = { setHeader() {}, status(code) { this.code = code; return this }, json(value) { this.value = value } }
    await handler({ method, headers, body }, response); return response
  }
  assert.equal((await call({}, {})).code, 401)
  assert.equal((await call({ authorization: 'Bearer secret' }, {}, 'GET')).code, 405)
  assert.equal((await call({ authorization: 'Bearer secret' }, { text: 'x'.repeat(2048) })).code, 413)
  const message = { id: 'a'.repeat(43), revision: 'revision', dueAt: 123 }
  assert.equal((await call({ authorization: 'Bearer secret' }, JSON.stringify(message))).code, 200)
  assert.deepEqual(messages, [message])
})
