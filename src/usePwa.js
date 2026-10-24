import { useEffect, useState } from 'react'

export function usePwa() {
  const [online, setOnline] = useState(navigator.onLine)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [waiting, setWaiting] = useState(null)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    const captureInstall = event => { event.preventDefault(); setInstallPrompt(event) }
    const markInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('beforeinstallprompt', captureInstall)
    window.addEventListener('appinstalled', markInstalled)
    let registration, cancelled = false, requestedReload = false
    const controllerChanged = () => {
      setReady(true)
      if (requestedReload) window.location.reload()
    }
    const requestReload = () => { requestedReload = true }
    window.addEventListener('pwa-reload', requestReload)
    const checkUpdate = () => {
      if (registration?.waiting) setWaiting(registration.waiting)
    }
    const observeUpdate = () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', checkUpdate)
    }
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async value => {
        registration = value
        if (cancelled) return
        checkUpdate()
        registration.addEventListener('updatefound', observeUpdate)
        await navigator.serviceWorker.ready
        if (!cancelled) setReady(Boolean(navigator.serviceWorker.controller))
      }).catch(() => { if (!cancelled) setError(true) })
    } else if (import.meta.env.PROD) setError(true)
    return () => {
      cancelled = true
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('beforeinstallprompt', captureInstall)
      window.removeEventListener('appinstalled', markInstalled)
      window.removeEventListener('pwa-reload', requestReload)
      navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged)
      registration?.removeEventListener('updatefound', observeUpdate)
    }
  }, [])

  return {
    online, ready, error, waiting, installed, installPrompt,
    install: async () => {
      if (!installPrompt) return
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    },
    update: () => {
      if (!waiting) return
      window.dispatchEvent(new Event('pwa-reload'))
      waiting.postMessage({ type: 'SKIP_WAITING' })
    },
  }
}
