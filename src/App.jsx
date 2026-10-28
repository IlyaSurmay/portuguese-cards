import { useState, useEffect, useRef, useMemo } from 'react'
import cardsData from './tatabogatacards.json'
import phraseExplanations from './phrase-explanations.json'
import {
  PROGRESS_KEY, INTERVAL_DAYS, STUDY_MODES, dueCards, loadSession, makeSnapshot, mergeStudyProgress,
  newProgress, progressByMode, restoreBackup, reviewCard, saveSession, undoReview, validateSnapshot,
} from './flashcards'
import { mixDeck, studyDay } from './studyQueue'
import { cachedAudioCount, downloadAudio } from './offline'
import { usePwa } from './usePwa'
import { useReminders } from './useReminders'
import { languages } from './translations'
import { VerbNotes } from './VerbNotes'
import verbDataUrl from './verb-explanations.json?url'
import './App.css'

const audioUrls = [...new Set(cardsData.map(card => card.audioSrc).filter(Boolean))]

function App() {
  const [initial] = useState(() => loadSession(cardsData))
  const [allProgress, setAllProgress] = useState(() => progressByMode(initial))
  const [studyMode, setStudyMode] = useState(initial.studyMode)
  const progress = allProgress[studyMode]
  const [language, setLanguage] = useState(initial.language)
  const [saveIssue, setSaveIssue] = useState(initial.issue)
  const progressRef = useRef(allProgress)
  const blockedRef = useRef(initial.issue === 'read')
  const [now, setNow] = useState(Date.now)
  const [currentId, setCurrentId] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [sortByProgress, setSortByProgress] = useState(false)
  const [sessionCounts, setSessionCounts] = useState({ forward: 0, inverse: 0 })
  const [mixRound, setMixRound] = useState(0)
  const [lastAnswer, setLastAnswer] = useState(null)
  const [undoNotice, setUndoNotice] = useState(null)
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
  const [verbData, setVerbData] = useState(null)
  const [verbLoading, setVerbLoading] = useState(false)
  const [verbLoadError, setVerbLoadError] = useState(false)
  const downloadRef = useRef(null)
  const pwa = usePwa()
  const reminder = useReminders(language, pwa)
  const text = languages[language]
  const inverse = studyMode === 'inverse'
  const answerVisible = !inverse || isFlipped
  const portugueseVisible = inverse ? isFlipped : !isFlipped
  const modeLabel = inverse ? text.inverseMode : text.forwardMode
  const day = studyDay(now)
  const orderedDeck = useMemo(() => mixDeck(cardsData, `${day}:${mixRound}`), [day, mixRound])
  const due = dueCards(orderedDeck, progress, now)
  const queue = browsing ? orderedDeck : due
  const currentCard = queue.find(card => card.id === currentId) ?? queue[0]
  const explanation = currentCard ? phraseExplanations[currentCard.id] : null
  const currentProgress = currentCard ? progress[currentCard.id] ?? newProgress() : null

  useEffect(() => { if (currentCard) setCurrentId(currentCard.id) }, [currentCard])
  useEffect(() => {
    if (!lastAnswer) return
    const timeout = setTimeout(() => setLastAnswer(null), Math.max(0, lastAnswer.expiresAt - Date.now()))
    return () => clearTimeout(timeout)
  }, [lastAnswer])
  useEffect(() => {
    if (!undoNotice) return
    const timeout = setTimeout(() => setUndoNotice(null), 4000)
    return () => clearTimeout(timeout)
  }, [undoNotice])
  const studied = Object.values(progress).filter(record => record.reviews > 0).length
  const stable = Object.values(progress).filter(record => record.stage >= 5).length
  const nextDueAt = Math.min(...Object.values(progress).filter(record => record.dueAt > now).map(record => record.dueAt))

  function applyProgress(records) {
    progressRef.current = records
    setAllProgress(records)
  }

  function persist(records, nextLanguage = language, nextMode = studyMode) {
    applyProgress(records)
    setLanguage(nextLanguage)
    setStudyMode(nextMode)
    if (blockedRef.current) { setSaveIssue('read'); return false }
    const result = saveSession(records.forward, nextLanguage, cardsData, { inverseProgress: records.inverse, studyMode: nextMode })
    applyProgress(progressByMode(result))
    setSaveIssue(result.ok ? null : 'write')
    return result.ok
  }

  useEffect(() => {
    if (initial.migrate) {
      const result = saveSession(initial.progress, initial.language, cardsData, initial)
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
        const merged = mergeStudyProgress(progressRef.current, progressByMode(snapshot))
        progressRef.current = merged
        setAllProgress(merged)
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
  }, [currentCard?.id, showStats, browsing, studyMode, language])

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
    if (!currentCard || browsing || showStats) return
    stopAudio()
    const timestamp = Date.now()
    const loaded = loadSession(cardsData)
    const records = mergeStudyProgress(progressByMode(loaded), progressRef.current)
    const previous = records[studyMode][currentCard.id]
    const reviewed = reviewCard(previous, value, timestamp)
    persist({ ...records, [studyMode]: { ...records[studyMode], [currentCard.id]: reviewed } })
    setLastAnswer({ id: currentCard.id, mode: studyMode, previous, reviewed, expiresAt: timestamp + 8000 })
    setUndoNotice(null)
    setNow(timestamp)
    setCurrentId(null)
    setIsFlipped(false)
    setSessionCounts(counts => ({ ...counts, [studyMode]: counts[studyMode] + 1 }))
  }

  function undoAnswer() {
    if (!lastAnswer || Date.now() >= lastAnswer.expiresAt) { setLastAnswer(null); return }
    const loaded = loadSession(cardsData)
    const records = mergeStudyProgress(progressByMode(loaded), progressRef.current)
    const mode = lastAnswer.mode
    const restored = undoReview(records[mode][lastAnswer.id], lastAnswer.reviewed, lastAnswer.previous)
    setLastAnswer(null)
    if (!restored) { applyProgress(records); setUndoNotice('undoConflict'); return }
    stopAudio()
    persist({ ...records, [mode]: { ...records[mode], [lastAnswer.id]: restored } }, language, mode)
    setBrowsing(false)
    setShowStats(false)
    setCurrentId(lastAnswer.id)
    setIsFlipped(false)
    setNow(Date.now())
    setSessionCounts(counts => ({ ...counts, [mode]: Math.max(0, counts[mode] - 1) }))
    setUndoNotice('answerUndone')
  }

  function mixCards() {
    stopAudio()
    const nextRound = mixRound + 1
    const mixed = mixDeck(cardsData, `${day}:${nextRound}`)
    setMixRound(nextRound)
    setCurrentId((browsing ? mixed : dueCards(mixed, progressRef.current[studyMode], Date.now()))[0]?.id ?? null)
    setIsFlipped(false)
  }

  function toggleStats() {
    stopAudio()
    setShowStats(value => !value)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  function toggleBrowsing() { stopAudio(); setBrowsing(value => !value); setCurrentId(null) }

  function changeMode(mode) {
    if (mode === studyMode) return
    stopAudio()
    explanationRef.current?.close()
    setIsFlipped(false)
    setCurrentId(null)
    setBrowsing(false)
    persist(progressRef.current, language, mode)
  }

  function changeLanguage(nextLanguage) {
    stopAudio()
    explanationRef.current?.close()
    setIsFlipped(false)
    persist(progressRef.current, nextLanguage)
  }

  function flipCard() {
    stopAudio()
    setIsFlipped(value => !value)
  }

  function openExplanation() {
    if (!answerVisible) return
    const dialog = explanationRef.current
    if (!dialog) return
    dialog.showModal()
    dialog.scrollTop = 0
    if (explanation.verbs.length && !verbData && !verbLoading) loadVerbNotes()
  }

  async function loadVerbNotes() {
    setVerbLoading(true)
    setVerbLoadError(false)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(verbDataUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('Verb notes unavailable')
      setVerbData(await response.json())
    } catch { setVerbLoadError(true) }
    finally { clearTimeout(timeout); setVerbLoading(false) }
  }

  async function playAudio() {
    const audio = audioRef.current
    if (!audio || !currentCard.audioSrc || !answerVisible) return
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
      const records = progressRef.current
      const snapshot = { ...makeSnapshot(records.forward, language, { inverseProgress: records.inverse, studyMode }), exportedAt: new Date().toISOString() }
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
    const merged = mergeStudyProgress(mergeStudyProgress(progressByMode(loaded), progressRef.current), progressByMode(pendingBackup))
    const ok = restoreBackup(merged.forward, pendingBackup.language, cardsData, { inverseProgress: merged.inverse, studyMode: pendingBackup.studyMode })
    stopAudio()
    explanationRef.current?.close()
    setIsFlipped(false)
    setCurrentId(null)
    setLastAnswer(null)
    setUndoNotice(null)
    applyProgress(merged)
    setLanguage(pendingBackup.language)
    setStudyMode(pendingBackup.studyMode)
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
    persist(mergeStudyProgress(progressByMode(loaded), progressRef.current))
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
    <div className="summary" aria-label={`${text.learningProgress}: ${modeLabel}`}>
      <div><strong>{due.length}</strong><span>{text.due}</span></div>
      <div><strong>{studied} / {cardsData.length}</strong><span>{text.studied}</span></div>
      <div><strong>{stable}</strong><span>{text.stable}</span></div>
      <div><strong>{sessionCounts[studyMode]}</strong><span>{text.session}</span></div>
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

      <div className="study-mode" role="group" aria-label={text.studyMode} aria-describedby="study-mode-hint">
        {STUDY_MODES.map(mode => <button type="button" key={mode} aria-pressed={studyMode === mode}
          onClick={() => changeMode(mode)}>{mode === 'forward' ? text.forwardMode : text.inverseMode}</button>)}
      </div>
      <p id="study-mode-hint" className="mode-hint muted">{text.modeHint}</p>

      {showStats && <>
        <div className="toolbar"><button onClick={toggleStats}>{text.backToCards}</button></div>
        <p className="muted">{modeLabel}</p>
        {summary}
      </>}

      {showStats ? <section aria-label={text.learningProgress}>
        <h2>{text.learningProgress}</h2>
        <button onClick={() => setSortByProgress(value => !value)}>{sortByProgress ? text.originalOrder : text.sortProgress}</button>
        <p className="muted">{text.scheduleHint}</p>
        <div className="cards-list">{statsCards.map(card => {
          const record = progress[card.id] ?? newProgress()
          return <article key={card.id} className={`card-stat ${record.stage >= 5 ? 'learned' : ''}`}>
            <p lang={inverse ? language : 'pt-PT'}>{inverse ? card[text.field] : card.portuguese}</p>
            <p lang={inverse ? 'pt-PT' : language}>{inverse ? card.portuguese : card[text.field]}</p>
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
                title={answerVisible ? text.explainPhrase : text.revealForTools} aria-haspopup="dialog" onClick={openExplanation} disabled={!answerVisible}>
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
              {explanation.structure && <p lang={language}>{explanation.structure[language]}</p>}
              {explanation.verbs.length > 0 && <section className="verb-explanations" aria-labelledby="verb-explanations-title">
                <h3 id="verb-explanations-title">{text.verbForms}</h3>
                {verbData ? <VerbNotes key={currentCard.id} entries={explanation.verbs} data={verbData} language={language} text={text} />
                  : verbLoadError ? <div role="alert">
                    <p>{text.verbLoadError}</p>
                    <button type="button" onClick={loadVerbNotes} disabled={verbLoading}>{text.retryExplanation}</button>
                  </div> : <p role="status">{text.verbLoading}</p>}
              </section>}
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
            <button type="button" key={`${studyMode}:${language}:${currentCard.id}`} className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={flipCard} aria-label={text.flip}
              aria-describedby={portugueseVisible ? 'card-portuguese' : 'card-translation'} aria-pressed={isFlipped}>
              <span className="flashcard-inner">
                <span className="flashcard-front" aria-hidden={isFlipped}><span id={inverse ? 'card-translation' : 'card-portuguese'} className="flashcard-text" lang={inverse ? language : 'pt-PT'}>{inverse ? currentCard[text.field] : currentCard.portuguese}</span></span>
                <span className="flashcard-back" aria-hidden={!isFlipped}><span id={inverse ? 'card-portuguese' : 'card-translation'} className="flashcard-text" lang={inverse ? 'pt-PT' : language}>{inverse ? currentCard.portuguese : currentCard[text.field]}</span></span>
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
          <button onClick={playAudio} className="audio-button" disabled={!currentCard.audioSrc || !answerVisible} aria-pressed={isPlaying}
            aria-describedby={!answerVisible ? 'reveal-tools-hint' : undefined}>
            <span aria-hidden="true">{isPlaying ? '■' : '▶'}</span>{' '}{!currentCard.audioSrc ? text.audioUnavailable : isPlaying ? text.stopAudio : text.playAudio}
          </button>
          {!answerVisible && <p id="reveal-tools-hint" className="tools-hint muted">{text.revealForTools}</p>}
          {audioError && <p className="error-text" role="alert">{text.audioError}</p>}
          {!browsing && <>
          <div className="review-actions">
            <button className="again-button" onClick={() => answer('again')}>{text.again}<small>{text.minutes}</small></button>
            <button className="remembered-button" onClick={() => answer('remembered')}>{text.remembered}<small>{new Intl.NumberFormat(language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(INTERVAL_DAYS[Math.min(currentProgress.stage, INTERVAL_DAYS.length - 1)])}</small></button>
          </div>
          </>}
        </> : <div className="empty-state" role="status">
          <h2>{text.allDone}</h2>
          {Number.isFinite(nextDueAt) && <p>{text.nextDue}: {formatDate(nextDueAt)}</p>}
        </div>}
        <div className="browse-control">
          <button onClick={toggleBrowsing}>{browsing ? text.returnReviews : text.browse}</button>
          <button onClick={mixCards} disabled={queue.length < 2}>{text.mixCards}</button>
          {lastAnswer && <button type="button" onClick={undoAnswer}>{text.undo}</button>}
        </div>
        {undoNotice && <p className="queue-hint muted" role="status">{text[undoNotice]}</p>}
        <p className="queue-hint muted">{text.queueHint}</p>
      </section>}

      {!showStats && <section className="study-summary" aria-label={text.learningProgress}>
        <p className="muted">{modeLabel}</p>
        {summary}
        <div className="toolbar"><button onClick={toggleStats}>{text.viewProgress}</button></div>
      </section>}

      <details className="settings-panel">
        <summary>{text.settings}</summary>
        <section className="settings-section">
          <label className="language-control">
            {text.language}
            <select value={language} onChange={event => changeLanguage(event.target.value)}>
              <option value="en" lang="en">English</option><option value="uk" lang="uk">Українська</option><option value="ru" lang="ru">Русский</option>
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
            <p>{text.importPreview}: {Object.keys(pendingBackup.progress).length + Object.keys(pendingBackup.inverseProgress).length}</p>
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
