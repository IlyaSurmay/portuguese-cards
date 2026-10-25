import { useState, useEffect, useRef } from 'react'
import cardsData from './tatabogatacards.json'
import phraseExplanations from './phrase-explanations.json'
import {
  PROGRESS_KEY, INTERVAL_DAYS, dueCards, loadSession, makeSnapshot, mergeProgress,
  newProgress, restoreBackup, reviewCard, saveSession, validateSnapshot,
} from './flashcards'
import { cachedAudioCount, downloadAudio } from './offline'
import { usePwa } from './usePwa'
import { useReminders } from './useReminders'
import { languages } from './translations'
import './App.css'

const audioUrls = [...new Set(cardsData.map(card => card.audioSrc).filter(Boolean))]

function App() {
  const [initial] = useState(() => loadSession(cardsData))
  const [progress, setProgress] = useState(initial.progress)
  const [language, setLanguage] = useState(initial.language)
  const [saveIssue, setSaveIssue] = useState(initial.issue)
  const progressRef = useRef(progress)
  const blockedRef = useRef(initial.issue === 'read')
  const [now, setNow] = useState(Date.now)
  const [currentId, setCurrentId] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [sortByProgress, setSortByProgress] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const [pendingBackup, setPendingBackup] = useState(null)
  const [notice, setNotice] = useState(null)
  const [audioCount, setAudioCount] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState(null)
  const [audioStorageError, setAudioStorageError] = useState(false)
  const audioRef = useRef(null)
  const explanationRef = useRef(null)
  const downloadRef = useRef(null)
  const pwa = usePwa()
  const reminder = useReminders(language, pwa)
  const text = languages[language]
  const due = dueCards(cardsData, progress, now)
  const queue = browsing ? cardsData : due
  const currentCard = queue.find(card => card.id === currentId) ?? queue[0]
  const explanation = currentCard ? phraseExplanations[currentCard.id] : null
  const currentProgress = currentCard ? progress[currentCard.id] ?? newProgress() : null
  const studied = Object.values(progress).filter(record => record.reviews > 0).length
  const stable = Object.values(progress).filter(record => record.stage >= 5).length
  const nextDueAt = Math.min(...Object.values(progress).filter(record => record.dueAt > now).map(record => record.dueAt))

  function applyProgress(records) {
    progressRef.current = records
    setProgress(records)
  }

  function persist(records, nextLanguage = language) {
    applyProgress(records)
    setLanguage(nextLanguage)
    if (blockedRef.current) { setSaveIssue('read'); return false }
    const result = saveSession(records, nextLanguage, cardsData)
    applyProgress(result.progress)
    setSaveIssue(result.ok ? null : 'write')
    return result.ok
  }

  useEffect(() => {
    if (initial.migrate) {
      const result = saveSession(initial.progress, initial.language, cardsData)
      if (!result.ok) setSaveIssue('write')
    }
  }, [initial])

  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 30000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])

  useEffect(() => {
    const changed = event => {
      if (event.key !== PROGRESS_KEY) return
      try {
        const snapshot = validateSnapshot(JSON.parse(event.newValue), cardsData)
        const merged = mergeProgress(progressRef.current, snapshot.progress)
        progressRef.current = merged
        setProgress(merged)
      } catch { setSaveIssue('read'); blockedRef.current = true }
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  useEffect(() => {
    if (!saveIssue) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveIssue])

  useEffect(() => {
    if (!('caches' in window)) { setAudioStorageError(true); return }
    const count = () => cachedAudioCount(audioUrls).then(setAudioCount).catch(() => setAudioStorageError(true))
    count()
    window.addEventListener('focus', count)
    return () => { window.removeEventListener('focus', count); downloadRef.current?.abort() }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    setIsFlipped(false)
    setIsPlaying(false)
    setAudioError(false)
    explanationRef.current?.close()
    return () => { audio?.pause() }
  }, [currentCard?.id, showStats, browsing])

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    setIsPlaying(false)
    setAudioError(false)
  }

  function navigate(direction) {
    stopAudio()
    setIsFlipped(false)
    const index = queue.findIndex(card => card.id === currentCard?.id)
    setCurrentId(queue[(index + direction + queue.length) % queue.length]?.id ?? null)
  }

  function answer(value) {
    if (!currentCard || !isFlipped || browsing) return
    stopAudio()
    const timestamp = Date.now()
    const next = { ...progressRef.current, [currentCard.id]: reviewCard(progressRef.current[currentCard.id], value, timestamp) }
    persist(next)
    setNow(timestamp)
    setCurrentId(null)
    setIsFlipped(false)
    setSessionCount(count => count + 1)
  }

  function toggleStats() {
    stopAudio()
    setShowStats(value => !value)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  function toggleBrowsing() { stopAudio(); setBrowsing(value => !value); setCurrentId(null) }

  function openExplanation() {
    const dialog = explanationRef.current
    if (!dialog) return
    dialog.showModal()
    dialog.scrollTop = 0
  }

  async function playAudio() {
    const audio = audioRef.current
    if (!audio || !currentCard.audioSrc) return
    if (!audio.paused) { stopAudio(); return }
    setAudioError(false)
    try { audio.currentTime = 0; await audio.play() }
    catch (error) {
      if (audioRef.current === audio && error.name !== 'AbortError') { setIsPlaying(false); setAudioError(true) }
    }
  }

  function formatDate(timestamp) {
    if (timestamp <= now) return text.now
    return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)
  }

  function exportProgress() {
    try {
      const snapshot = { ...makeSnapshot(progressRef.current, language), exportedAt: new Date().toISOString() }
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `portuguese-cards-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setNotice('exportError') }
  }

  async function chooseBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Oversized backup')
      const snapshot = validateSnapshot(JSON.parse(await file.text()), cardsData)
      setPendingBackup(snapshot)
      setNotice(null)
    } catch { setPendingBackup(null); setNotice('importError') }
  }

  function importProgress() {
    if (!pendingBackup) return
    const loaded = loadSession(cardsData)
    const merged = mergeProgress(mergeProgress(loaded.progress, progressRef.current), pendingBackup.progress)
    const ok = restoreBackup(merged, pendingBackup.language, cardsData)
    applyProgress(merged)
    setLanguage(pendingBackup.language)
    blockedRef.current = !ok
    setSaveIssue(ok ? null : 'write')
    setPendingBackup(null)
    setNotice(ok ? 'imported' : 'backupImportedUnsaved')
    setNow(Date.now())
  }

  function retrySave() {
    const loaded = loadSession(cardsData)
    if (loaded.issue) { setSaveIssue('read'); return }
    blockedRef.current = false
    persist(mergeProgress(loaded.progress, progressRef.current))
  }

  async function startDownload() {
    if (downloading) return
    const controller = new AbortController()
    downloadRef.current = controller
    setDownloading(true)
    setDownloadNotice(null)
    try {
      navigator.storage?.persist?.().catch(() => {})
      const result = await downloadAudio(audioUrls, {
        signal: controller.signal,
        onProgress: value => setAudioCount(value.completed),
      })
      setAudioCount(result.completed)
      setDownloadNotice(result.cancelled ? 'downloadStopped' : result.failed ? 'downloadFailed' : 'downloadComplete')
    } catch { setDownloadNotice('downloadFailed') }
    finally { setDownloading(false); downloadRef.current = null }
  }

  const statsCards = [...cardsData].sort((a, b) => sortByProgress
    ? (progress[b.id]?.stage ?? 0) - (progress[a.id]?.stage ?? 0) : 0)

  const summary = (
    <div className="summary" aria-label={text.learningProgress}>
      <div><strong>{due.length}</strong><span>{text.due}</span></div>
      <div><strong>{studied} / {cardsData.length}</strong><span>{text.studied}</span></div>
      <div><strong>{stable}</strong><span>{text.stable}</span></div>
      <div><strong>{sessionCount}</strong><span>{text.session}</span></div>
    </div>
  )

  return (
    <main className="app-container">
      <header className="app-header">
        <div><h1>{text.title}</h1><p>{text.subtitle}</p></div>
      </header>

      <div className="status-row" role="status">
        <span className={pwa.online ? 'online-badge' : 'offline-badge'}>{pwa.online ? text.online : text.offline}</span>
        <span>{pwa.ready ? text.offlineReady : pwa.error ? text.offlineError : text.offlinePreparing}</span>
      </div>
      {saveIssue && <div className="alert" role="alert">
        <p>{saveIssue === 'read' ? text.readError : text.saveError}</p>
        <button onClick={exportProgress}>{text.export}</button>{' '}
        <button onClick={retrySave}>{text.retrySave}</button>
      </div>}
      {pwa.waiting && <div className="update-banner" role="status">
        <span>{text.updateAvailable}</span>
        <button disabled={Boolean(saveIssue) || pwa.updating} onClick={pwa.update} aria-busy={pwa.updating}>
          {pwa.updating ? text.updating : text.update}
        </button>
        {saveIssue && <span>{text.updateBlocked}</span>}
        {pwa.updateError && <span role="alert">{text.updateError}</span>}
      </div>}

      {showStats && <>
        <div className="toolbar"><button onClick={toggleStats}>{text.backToCards}</button></div>
        {summary}
      </>}

      {showStats ? <section aria-label={text.learningProgress}>
        <h2>{text.learningProgress}</h2>
        <button onClick={() => setSortByProgress(value => !value)}>{sortByProgress ? text.originalOrder : text.sortProgress}</button>
        <p className="muted">{text.scheduleHint}</p>
        <div className="cards-list">{statsCards.map(card => {
          const record = progress[card.id] ?? newProgress()
          return <article key={card.id} className={`card-stat ${record.stage >= 5 ? 'learned' : ''}`}>
            <p lang="pt-PT">{card.portuguese}</p><p lang={language}>{card[text.field]}</p>
            <div className="card-stat-progress">{text.stage}: {record.stage} / {INTERVAL_DAYS.length} · {text.reviews}: {record.reviews}</div>
            <div className="card-stat-progress">{text.nextReview}: {record.reviews ? formatDate(record.dueAt) : text.newCard}</div>
          </article>
        })}</div>
      </section> : <section aria-label={text.backToCards}>
        {browsing && <p className="muted">{text.practiceNote}</p>}
        {currentCard ? <>
          <div className="card-meta">
            <span>{currentProgress.reviews ? `${text.stage}: ${currentProgress.stage} / ${INTERVAL_DAYS.length}` : text.newCard}</span>
            <div className="card-tools">
              <span>{browsing && currentProgress.reviews ? `${text.nextReview}: ${formatDate(currentProgress.dueAt)}` : `${queue.findIndex(card => card.id === currentCard.id) + 1} / ${queue.length}`}</span>
              <button type="button" className="phrase-info-button" aria-label={text.explainPhrase}
                title={text.explainPhrase} aria-haspopup="dialog" onClick={openExplanation}>
                <span aria-hidden="true">ⓘ</span>
              </button>
            </div>
          </div>
          {explanation && <dialog ref={explanationRef} className="phrase-explanation" aria-labelledby="phrase-explanation-title">
            <div className="explanation-header">
              <h2 id="phrase-explanation-title">{text.explainPhrase}</h2>
              <button type="button" onClick={() => explanationRef.current.close()} aria-label={text.closeExplanation}>×</button>
            </div>
            <div className="explanation-content">
              <p className="explanation-phrase" lang="pt-PT">{currentCard.portuguese}</p>
              <h3>{text.phraseParts}</h3>
              <dl className="phrase-parts">{explanation.parts.map(part => <div key={part.pt}>
                <dt lang="pt-PT">{part.pt}</dt><dd lang={language}>{part[language]}</dd>
              </div>)}</dl>
              <h3>{text.grammarNote}</h3>
              <p lang={language}>{explanation.grammar[language]}</p>
              <h3>{text.anotherExample}</h3>
              <div className="phrase-example">
                <p lang="pt-PT">{explanation.example.pt}</p>
                <p lang={language}>{explanation.example[language]}</p>
              </div>
              <p className="muted">{text.explanationHint}</p>
            </div>
          </dialog>}
          <div className="flashcard-container">
            <button onClick={() => navigate(-1)} className="side-button" aria-label={text.previous}>←</button>
            <button type="button" className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={() => setIsFlipped(value => !value)} aria-label={text.flip}
              aria-describedby={isFlipped ? 'card-translation' : 'card-portuguese'} aria-pressed={isFlipped}>
              <span className="flashcard-inner">
                <span className="flashcard-front" aria-hidden={isFlipped}><span id="card-portuguese" className="flashcard-text" lang="pt-PT">{currentCard.portuguese}</span></span>
                <span className="flashcard-back" aria-hidden={!isFlipped}><span id="card-translation" className="flashcard-text" lang={language}>{currentCard[text.field]}</span></span>
              </span>
            </button>
            <button onClick={() => navigate(1)} className="side-button" aria-label={text.next}>→</button>
          </div>
          <audio key={currentCard.id} ref={audioRef} src={currentCard.audioSrc || undefined} preload="none"
            onLoadedData={() => cachedAudioCount(audioUrls).then(setAudioCount).catch(() => {})}
            onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => {
              setIsPlaying(false)
              cachedAudioCount(audioUrls).then(setAudioCount).catch(() => {})
            }} onError={() => { setIsPlaying(false); setAudioError(true) }} />
          <button onClick={playAudio} className="audio-button" disabled={!currentCard.audioSrc} aria-pressed={isPlaying}>
            <span aria-hidden="true">{isPlaying ? '■' : '▶'}</span>{' '}{!currentCard.audioSrc ? text.audioUnavailable : isPlaying ? text.stopAudio : text.playAudio}
          </button>
          {audioError && <p className="error-text" role="alert">{text.audioError}</p>}
          {!browsing && (isFlipped ? <div className="review-actions">
            <button className="again-button" onClick={() => answer('again')}>{text.again}<small>{text.minutes}</small></button>
            <button className="remembered-button" onClick={() => answer('remembered')}>{text.remembered}<small>{INTERVAL_DAYS[Math.min(currentProgress.stage, INTERVAL_DAYS.length - 1)]} {text.days}</small></button>
          </div> : <div className="reveal-section"><p className="muted">{text.rateHint}</p><button className="primary" onClick={() => setIsFlipped(true)}>{text.reveal}</button></div>)}
        </> : <div className="empty-state" role="status">
          <h2>{text.allDone}</h2>
          {Number.isFinite(nextDueAt) && <p>{text.nextDue}: {formatDate(nextDueAt)}</p>}
        </div>}
        <div className="browse-control"><button onClick={toggleBrowsing}>{browsing ? text.returnReviews : text.browse}</button></div>
      </section>}

      {!showStats && <section className="study-summary" aria-label={text.learningProgress}>
        {summary}
        <div className="toolbar"><button onClick={toggleStats}>{text.viewProgress}</button></div>
      </section>}

      <details className="settings-panel">
        <summary>{text.settings}</summary>
        <section className="settings-section">
          <label className="language-control">
            {text.language}
            <select value={language} onChange={event => persist(progressRef.current, event.target.value)}>
              <option value="uk" lang="uk">Українська</option><option value="ru" lang="ru">Русский</option><option value="en" lang="en">English</option>
            </select>
          </label>
        </section>
        <section className="settings-section" aria-labelledby="reminder-title">
          <h2 id="reminder-title">{text.dailyReminder}</h2>
          <p className="muted">{text.reminderDescription}</p>
          {reminder.needsInstall ? <p>{text.reminderInstallIos}</p> : !reminder.supported ? <p>{text.reminderUnsupported}</p> : <>
            <p>{reminder.enabled ? text.reminderOn : text.reminderOff}</p>
            <form className="reminder-form" onSubmit={reminder.save} aria-busy={reminder.busy}>
              <label>{text.reminderTime}<input type="time" required value={reminder.time} onChange={event => reminder.setTime(event.target.value)} disabled={reminder.busy} /></label>
              <p className="muted">{text.reminderTimeZone}: {reminder.timeZone}</p>
              <button type="submit" disabled={!reminder.canSave}>{reminder.busy ? text.reminderWorking : reminder.enabled ? text.reminderSaveTime : text.reminderEnable}</button>
            </form>
            {reminder.saved?.enabled && <div className="reminder-actions">
              <button onClick={reminder.test} disabled={reminder.busy || !pwa.online || !reminder.enabled}>{text.reminderTest}</button>
              <button onClick={reminder.disable} disabled={reminder.busy || !pwa.online}>{text.reminderDisable}</button>
            </div>}
            {reminder.enabled && reminder.saved?.nextDueAt && <p className="muted">{text.reminderNext}: {formatDate(reminder.saved.nextDueAt)}</p>}
            {reminder.permission === 'denied' && <p>{text.reminderPermissionDenied}</p>}
            {!pwa.online && <p className="muted">{text.reminderNeedsInternet}</p>}
            {reminder.issue && reminder.issue !== 'reminderPermissionDenied' && <p className="error-text" role="alert">{text[reminder.issue]}</p>}
            {reminder.notice && <p role="status">{text[reminder.notice]}</p>}
          </>}
        </section>
        <section className="settings-section">
          <h2>{text.audioDownloads}</h2>
          <p>{text.audioSaved}: <strong>{audioCount} / {audioUrls.length}</strong></p>
          <progress value={audioCount} max={audioUrls.length} aria-label={text.audioDownloads} />
          <p className="muted">{text.downloadHint}</p>
          {audioStorageError ? <p className="error-text">{text.downloadUnsupported}</p> : downloading
            ? <button onClick={() => downloadRef.current?.abort()}>{text.stopDownload}</button>
            : <button onClick={startDownload} disabled={!pwa.online || audioCount === audioUrls.length}>{text.download}</button>}
          <p role="status">{downloading ? text.downloading : downloadNotice ? text[downloadNotice] : audioCount === audioUrls.length ? text.downloadComplete : ''}</p>
        </section>
        <section className="settings-section">
          <h2>{text.export}</h2><p className="muted">{text.backupHint}</p>
          <div className="backup-actions"><button onClick={exportProgress}>{text.export}</button>
            <label className="file-button">{text.import}<input type="file" accept="application/json,.json" onChange={chooseBackup} /></label>
          </div>
          {pendingBackup && <div className="import-preview">
            <p>{text.importPreview}: {Object.keys(pendingBackup.progress).length}</p>
            {pendingBackup.skipped > 0 && <p>{text.skipped}: {pendingBackup.skipped}</p>}
            <p className="muted">{text.mergeHint}</p>
            <button className="primary" onClick={importProgress}>{text.merge}</button>{' '}
            <button onClick={() => setPendingBackup(null)}>{text.cancel}</button>
          </div>}
          {notice && <p role={notice === 'imported' ? 'status' : 'alert'}>{text[notice]}</p>}
          <p className="muted">{text.storageHint}</p>
        </section>
        <section className="settings-section">
          <h2>{text.installTitle}</h2>
          {pwa.installed ? <p>{text.installed}</p> : <>
            {pwa.installPrompt && <button className="primary" onClick={pwa.install}>{text.install}</button>}
            <p>{text.installIos}</p><p>{text.installAndroid}</p>
          </>}
          <p className="muted">{text.installationHint}</p>
        </section>
        <p className="muted">{text.scheduleHint}</p>
      </details>
      <footer><a href="https://portuguese-cards.vercel.app/">portuguese-cards.vercel.app</a></footer>
    </main>
  )
}

export default App
