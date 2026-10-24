// Re-read the live registration when clicked: a toast's worker may already have
// activated in another tab. That transition will not fire controllerchange again.
export function activateUpdate(container, registration, loadedController, timeoutMs = 12000) {
  const target = registration?.waiting
    ?? (registration?.active !== loadedController ? registration?.active : null)
  if (!target || target.state === 'redundant') return Promise.reject(new Error('No usable update'))

  return new Promise((resolve, reject) => {
    let settled = false
    let poll, timeout
    const finish = error => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timeout)
      target.removeEventListener('statechange', check)
      container.removeEventListener('controllerchange', check)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (target.state === 'redundant') finish(new Error('Update was replaced'))
      else if (target.state === 'activated' && container.controller === target) finish()
    }

    target.addEventListener('statechange', check)
    container.addEventListener('controllerchange', check)
    // Some mobile browsers delay lifecycle events when returning from suspension.
    // Poll the actual state too; never reload before the new worker is in control.
    poll = setInterval(check, 100)
    timeout = setTimeout(() => finish(new Error('Update timed out')), timeoutMs)
    check()
    if (settled) return
    try {
      if (registration.waiting === target) target.postMessage({ type: 'SKIP_WAITING' })
    } catch (error) { finish(error) }
  })
}
