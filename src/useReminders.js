import { useCallback, useEffect, useRef, useState } from 'react'
import { applicationServerKey, newReminder, readReminder, reminderRequest, writeReminder } from './reminders'

export function useReminders(language, pwa) {
  const [initial] = useState(() => {
    try { return { saved: readReminder() } } catch { return { saved: null, error: 'reminderStorageError' } }
  })
  const savedRef = useRef(initial.saved)
  const busyRef = useRef(false)
  const [saved, setSaved] = useState(initial.saved)
  const [time, setTime] = useState(initial.saved?.time ?? '19:00')
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState(initial.error ?? null)
  const [notice, setNotice] = useState(null)
  const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'default')
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const needsInstall = ios && !pwa.installed
  const supported = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator && window.isSecureContext
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const enabled = Boolean(saved?.enabled) && permission === 'granted'

  const keep = useCallback(value => {
    writeReminder(value)
    savedRef.current = value
    setSaved(value)
  }, [])
  function begin() {
    if (busyRef.current) return false
    busyRef.current = true; setBusy(true); setIssue(null); setNotice(null)
    return true
  }
  function end() { busyRef.current = false; setBusy(false) }

  useEffect(() => {
    if (!supported || needsInstall || !pwa.online) return
    const controller = new AbortController()
    let cancelled = false
    const timeout = setTimeout(() => controller.abort(), 20000)
    fetch('/api/reminders', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const value = await response.json()
      if (!response.ok || !value.publicKey) throw new Error()
      setConfig(value)
      setIssue(previous => previous === 'reminderUnavailable' ? null : previous)
    }).catch(() => { if (!cancelled) setIssue('reminderUnavailable') }).finally(() => clearTimeout(timeout))
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout) }
  }, [supported, needsInstall, pwa.online])

  useEffect(() => {
    if (!supported || needsInstall || !pwa.online || !pwa.ready) return
    let cancelled = false
    const sync = async () => {
      setPermission(Notification.permission)
      const previous = savedRef.current
      if (!previous || busyRef.current) return
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = await registration?.pushManager.getSubscription()
        if (cancelled || busyRef.current) return
        if (!subscription || Notification.permission !== 'granted') {
          if (previous.enabled) {
            await reminderRequest('disable', previous)
            if (!cancelled) { keep({ ...previous, enabled: false }); setNotice('reminderExpired') }
          }
          return
        }
        const status = await reminderRequest('status', previous)
        if (cancelled || busyRef.current) return
        if (!status.enabled) { keep({ ...previous, enabled: false }); setNotice('reminderExpired'); return }
        if (status.language !== language || status.timeZone !== timeZone) {
          const updated = await reminderRequest('save', previous, { subscription: subscription.toJSON(), time: status.time, timeZone, language })
          if (!cancelled) keep({ ...previous, ...updated })
        } else keep({ ...previous, ...status })
      } catch { if (!cancelled) setIssue('reminderSyncError') }
    }
    sync()
    const resumed = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', resumed)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', resumed) }
  }, [supported, needsInstall, pwa.online, pwa.ready, language, timeZone, keep])

  async function save(event) {
    event.preventDefault()
    if (!config || !begin()) return
    let created = null
    try {
      // Store the management credential before creating a server-side schedule.
      let credentials = savedRef.current
      if (!credentials) { credentials = newReminder(); keep(credentials) }
      else writeReminder(credentials)
      // iOS requires the permission request directly within the button gesture.
      const granted = await Notification.requestPermission()
      setPermission(granted)
      if (granted !== 'granted') { setIssue('reminderPermissionDenied'); return }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) })
        created = subscription
      }
      const result = await reminderRequest('save', credentials, { subscription: subscription.toJSON(), time, timeZone, language })
      keep({ ...credentials, ...result })
      setNotice('reminderSaved')
    } catch (error) {
      if (created) {
        await created.unsubscribe().catch(() => {})
        await reminderRequest('disable', savedRef.current).catch(() => {})
      }
      setIssue(error.message?.startsWith('reminder') ? error.message : error.name === 'QuotaExceededError' ? 'reminderStorageError' : 'reminderSaveError')
    } finally { end() }
  }

  async function disable() {
    if (!savedRef.current || !begin()) return
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription && !await subscription.unsubscribe()) throw new Error('reminderDisableError')
      await reminderRequest('disable', savedRef.current)
      keep({ ...savedRef.current, enabled: false })
      setNotice('reminderDisabled')
    } catch { setIssue('reminderDisableError') }
    finally { end() }
  }
  async function test() {
    if (!savedRef.current || !begin()) return
    try { await reminderRequest('test', savedRef.current); setNotice('reminderTestSent') }
    catch (error) {
      if (error.message === 'reminderExpired') {
        try { keep({ ...savedRef.current, enabled: false }) } catch { /* The error below remains visible. */ }
      }
      setIssue(error.message?.startsWith('reminder') ? error.message : 'reminderSaveError')
    } finally { end() }
  }

  return { supported, needsInstall, time, setTime, timeZone, enabled, saved, busy, issue, notice, permission, save, disable, test,
    canSave: Boolean(config) && pwa.online && pwa.ready && !busy && !needsInstall && supported && issue !== 'reminderStorageError' && permission !== 'denied' }
}
