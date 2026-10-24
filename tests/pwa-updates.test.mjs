import test from 'node:test'
import assert from 'node:assert/strict'
import { activateUpdate } from '../src/pwaUpdates.js'

class Worker extends EventTarget {
  constructor(state) { super(); this.state = state; this.messages = [] }
  postMessage(message) { this.messages.push(message) }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}
class Container extends EventTarget {
  constructor(controller) { super(); this.controller = controller }
  claim(worker) { this.controller = worker; this.dispatchEvent(new Event('controllerchange')) }
}

test('an ordinary update waits for activation and control before permitting reload', async () => {
  const old = new Worker('activated'), next = new Worker('installed')
  const container = new Container(old)
  let finished = false
  const update = activateUpdate(container, { waiting: next, active: old }, old).then(() => { finished = true })
  assert.deepEqual(next.messages, [{ type: 'SKIP_WAITING' }])
  next.change('activated')
  await Promise.resolve()
  assert.equal(finished, false)
  container.claim(next)
  await update
  assert.equal(finished, true)
})

test('a stale toast can reload after another tab already activated the update', async () => {
  const old = new Worker('activated'), next = new Worker('activated')
  const container = new Container(next)
  await activateUpdate(container, { waiting: null, active: next }, old)
  assert.equal(next.messages.length, 0)
})

test('a controller adopted during activation is awaited without posting to a stale waiting worker', async () => {
  const old = new Worker('activated'), next = new Worker('activating')
  const container = new Container(next)
  const update = activateUpdate(container, { waiting: null, active: next }, old)
  assert.equal(next.messages.length, 0)
  next.change('activated')
  await update
})

test('mobile browsers can complete updates even when lifecycle notifications are missed', async () => {
  const old = new Worker('activated'), next = new Worker('installed')
  const container = new Container(old)
  const update = activateUpdate(container, { waiting: next, active: old }, old, 1000)
  // Change the real state without dispatching events, as after a mobile suspension.
  next.state = 'activated'
  container.controller = next
  await update
})

test('replaced or stalled updates fail visibly and may be retried', async () => {
  const old = new Worker('activated'), next = new Worker('installed')
  const container = new Container(old)
  const update = activateUpdate(container, { waiting: next, active: old }, old)
  next.change('redundant')
  await assert.rejects(update, /replaced/)
  const retry = new Worker('installed')
  await assert.rejects(activateUpdate(container, { waiting: retry, active: old }, old, 20), /timed out/)
  retry.state = 'activated'
  container.controller = retry
  await activateUpdate(container, { waiting: null, active: retry }, old)
})

test('missing registrations and rejected messages do not silently succeed', async () => {
  const old = new Worker('activated'), container = new Container(old)
  await assert.rejects(activateUpdate(container, null, old), /No usable update/)
  await assert.rejects(activateUpdate(container, { waiting: null, active: old }, old), /No usable update/)
  const next = new Worker('installed')
  next.postMessage = () => { throw new Error('Disconnected worker') }
  await assert.rejects(activateUpdate(container, { waiting: next, active: old }, old), /Disconnected/)
})
