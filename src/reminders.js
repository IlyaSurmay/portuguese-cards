export const REMINDER_KEY = 'portuguese-cards-reminder-v1'

export function readReminder() {
  const value = JSON.parse(localStorage.getItem(REMINDER_KEY) || 'null')
  if (value === null) return null
  if (!/^[\w-]{43}$/.test(value.id) || !/^[\w-]{43}$/.test(value.token) || typeof value.enabled !== 'boolean') throw new Error('reminderStorageError')
  return value
}
export function writeReminder(value) {
  try { localStorage.setItem(REMINDER_KEY, JSON.stringify(value)) } catch { throw new Error('reminderStorageError') }
}
export function newReminder() {
  const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return { id: random(), token: random(), enabled: false, time: '19:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}
export function applicationServerKey(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
}
export async function reminderRequest(action, credentials, data = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch('/api/reminders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}` },
      body: JSON.stringify({ action, id: credentials.id, ...data }), signal: controller.signal, cache: 'no-store',
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.code === 'testLimited' ? 'reminderTestLimited'
      : result.code === 'subscriptionExpired' ? 'reminderExpired' : 'reminderSaveError')
    return result
  } finally { clearTimeout(timeout) }
}
