import { useEffect, useRef, useState } from 'react'
import { activateUpdate } from './pwaUpdates'

export function usePwa() {
  const [online, setOnline] = useState(navigator.onLine)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [waiting, setWaiting] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)
  const registrationRef = useRef(null)
  const loadedController = useRef(navigator.serviceWorker?.controller ?? null)
  const updatingRef = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const updateOnline = () => setOnline(navigator.onLine)
    const captureInstall = event => { event.preventDefault(); setInstallPrompt(event) }
    const markInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('beforeinstallprompt', captureInstall)
    window.addEventListener('appinstalled', markInstalled)
    let registration, cancelled = false
    const observed = new Set()
    const syncUpdate = () => {
      if (cancelled) return
      const controller = navigator.serviceWorker.controller
      setReady(Boolean(controller))
      if (!loadedController.current && controller && !updatingRef.current) loadedController.current = controller
      // Keep a reload action when another tab has already activated the new
      // worker: this document still runs the previous application's JavaScript.
      const next = registration?.waiting ?? (controller !== loadedController.current ? controller : null)
      setWaiting(next?.state === 'redundant' ? null : next)
    }
    const workerChanged = () => queueMicrotask(syncUpdate)
    const observeUpdate = () => {
      for (const worker of [registration?.installing, registration?.waiting]) {
        if (worker && !observed.has(worker)) {
          observed.add(worker)
          worker.addEventListener('statechange', workerChanged)
        }
      }
      syncUpdate()
    }
    const resumed = () => {
      if (document.visibilityState === 'visible') {
        syncUpdate()
        if (navigator.onLine) registration?.update().catch(() => {})
      }
    }
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', syncUpdate)
      document.addEventListener('visibilitychange', resumed)
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async value => {
        registration = value
        if (cancelled) return
        registrationRef.current = registration
        registration.addEventListener('updatefound', observeUpdate)
        observeUpdate()
        await navigator.serviceWorker.ready
        syncUpdate()
      }).catch(() => { if (!cancelled) setError(true) })
    } else if (import.meta.env.PROD) setError(true)
    return () => {
      cancelled = true
      mounted.current = false
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('beforeinstallprompt', captureInstall)
      window.removeEventListener('appinstalled', markInstalled)
      document.removeEventListener('visibilitychange', resumed)
      navigator.serviceWorker?.removeEventListener('controllerchange', syncUpdate)
      registration?.removeEventListener('updatefound', observeUpdate)
      for (const worker of observed) worker.removeEventListener('statechange', workerChanged)
    }
  }, [])

  return {
    online, ready, error, waiting, updating, updateError, installed, installPrompt,
    install: async () => {
      if (!installPrompt) return
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    },
    update: async () => {
      if (updatingRef.current) return
      updatingRef.current = true
      setUpdating(true)
      setUpdateError(false)
      try {
        const registration = registrationRef.current ?? await navigator.serviceWorker.getRegistration()
        await activateUpdate(navigator.serviceWorker, registration, loadedController.current)
        window.location.reload()
      } catch {
        if (mounted.current) setUpdateError(true)
      } finally {
        updatingRef.current = false
        if (mounted.current) setUpdating(false)
      }
    },
  }
}
