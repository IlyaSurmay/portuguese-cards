export const PROGRESS_KEY = 'portuguese-cards-progress-v2'
export const BACKUP_APP = 'portuguese-cards'
export const SNAPSHOT_VERSION = 3
export const STUDY_MODES = ['forward', 'inverse']
export const DAY = 24 * 60 * 60 * 1000
export const AGAIN_DELAY = 10 * 60 * 1000
export const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60]

export const newProgress = () => ({ stage: 0, reviews: 0, lapses: 0, dueAt: 0, lastReviewedAt: null })

export function reviewCard(previous = newProgress(), answer, now = Date.now()) {
  if (!['again', 'remembered'].includes(answer)) throw new Error('Invalid answer')
  const stage = answer === 'again' ? 0 : Math.min(previous.stage + 1, INTERVAL_DAYS.length)
  return {
    stage,
    reviews: previous.reviews + 1,
    lapses: previous.lapses + (answer === 'again' ? 1 : 0),
    dueAt: now + (answer === 'again' ? AGAIN_DELAY : INTERVAL_DAYS[stage - 1] * DAY),
    lastReviewedAt: now,
    updatedAt: Math.max(now, (previous.updatedAt ?? previous.lastReviewedAt ?? 0) + 1),
  }
}

export function migrateLegacy(deck, saved) {
  const records = {}
  if (!Array.isArray(saved)) throw new Error('Invalid legacy progress')
  for (const [index, card] of deck.entries()) {
    const previous = saved.find(item => item?.id === card.id || item?.portuguese === card.portuguese)
      ?? saved.find(item => item && !item.portuguese && item.originalIndex === index)
    const count = previous?.isLearned ? 5 : Number.isFinite(previous?.timesLearned)
      ? Math.max(0, Math.min(5, Math.floor(previous.timesLearned))) : 0
    if (count) records[card.id] = { ...newProgress(), stage: count, reviews: count }
  }
  return records
}

function validRecord(record) {
  return record && typeof record === 'object' && !Array.isArray(record)
    && Number.isInteger(record.stage) && record.stage >= 0 && record.stage <= INTERVAL_DAYS.length
    && Number.isSafeInteger(record.reviews) && record.reviews >= 0
    && Number.isSafeInteger(record.lapses) && record.lapses >= 0 && record.lapses <= record.reviews
    && record.stage <= record.reviews
    && (record.updatedAt === undefined || (Number.isSafeInteger(record.updatedAt) && record.updatedAt >= (record.lastReviewedAt ?? 0) && record.updatedAt <= 8640000000000000))
    && Number.isSafeInteger(record.dueAt) && record.dueAt >= 0 && record.dueAt <= 8640000000000000
    && (record.lastReviewedAt === null || (Number.isSafeInteger(record.lastReviewedAt) && record.lastReviewedAt >= 0 && record.lastReviewedAt <= 8640000000000000))
}

// Only progress is persisted; phrases, translations and recordings always come from the current deck.
export function validateSnapshot(value, deck) {
  if (!value || value.app !== BACKUP_APP || ![2, SNAPSHOT_VERSION].includes(value.version)
    || !['uk', 'ru', 'en'].includes(value.language)
    || (value.version === SNAPSHOT_VERSION && !STUDY_MODES.includes(value.studyMode))) {
    throw new Error('Invalid backup')
  }
  const known = new Set(deck.map(card => card.id))
  let skipped = 0
  function validateRecords(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Invalid progress')
    const result = {}
    for (const [id, record] of Object.entries(records)) {
      if (!validRecord(record)) throw new Error('Invalid progress record')
      if (!known.has(id)) { skipped++; continue }
      result[id] = {
        stage: record.stage, reviews: record.reviews, lapses: record.lapses,
        dueAt: record.dueAt, lastReviewedAt: record.lastReviewedAt,
        ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
      }
    }
    return result
  }
  const progress = validateRecords(value.progress)
  const inverseProgress = validateRecords(value.version === 2 ? {} : value.inverseProgress)
  if (skipped && !Object.keys(progress).length && !Object.keys(inverseProgress).length) throw new Error('Backup belongs to another deck')
  return { progress, inverseProgress, studyMode: value.version === 2 ? 'forward' : value.studyMode, language: value.language, skipped }
}

export function makeSnapshot(progress, language, { inverseProgress = {}, studyMode = 'forward' } = {}) {
  return { app: BACKUP_APP, version: SNAPSHOT_VERSION, language, studyMode, progress, inverseProgress }
}

export function progressByMode(snapshot) {
  return { forward: snapshot.progress, inverse: snapshot.inverseProgress }
}

export function mergeStudyProgress(current, incoming) {
  return {
    forward: mergeProgress(current.forward, incoming.forward),
    inverse: mergeProgress(current.inverse, incoming.inverse),
  }
}

// Undo is a new change even when it restores an older review date or a new card.
const changedAt = record => record?.updatedAt ?? record?.lastReviewedAt ?? 0

export function undoReview(current, reviewed, previous, now = Date.now()) {
  const fields = ['stage', 'reviews', 'lapses', 'dueAt', 'lastReviewedAt']
  if (!current || changedAt(current) !== changedAt(reviewed) || fields.some(field => current[field] !== reviewed[field])) return null
  return { ...(previous ?? newProgress()), updatedAt: Math.max(now, changedAt(reviewed) + 1) }
}

export function mergeProgress(current, incoming) {
  const merged = { ...current }
  for (const [id, record] of Object.entries(incoming)) {
    const previous = merged[id]
    if (!previous || changedAt(record) >= changedAt(previous)) merged[id] = record
  }
  return merged
}

export function loadSession(deck) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (raw !== null) {
      const snapshot = JSON.parse(raw)
      return { ...validateSnapshot(snapshot, deck), issue: null, migrate: snapshot.version === 2 }
    }
    const legacy = localStorage.getItem('flashcards')
    const savedLanguage = localStorage.getItem('flashcards-language')
    let language = 'en'
    try {
      const preferred = savedLanguage && JSON.parse(savedLanguage)
      if (['en', 'uk', 'ru'].includes(preferred)) language = preferred
    } catch { /* Preferences do not invalidate progress. */ }
    return {
      progress: legacy === null ? {} : migrateLegacy(deck, JSON.parse(legacy)), language,
      inverseProgress: {}, studyMode: 'forward',
      issue: null, migrate: true,
    }
  } catch {
    // Keep unreadable data untouched. Export remains available for this session;
    // importing a valid backup is the explicit recovery path.
    return { progress: {}, inverseProgress: {}, studyMode: 'forward', language: 'en', issue: 'read', migrate: false }
  }
}

export function saveSession(progress, language, deck, { inverseProgress = {}, studyMode = 'forward' } = {}) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const stored = raw === null ? { progress: {}, inverseProgress: {} } : validateSnapshot(JSON.parse(raw), deck)
    const merged = mergeStudyProgress(progressByMode(stored), { forward: progress, inverse: inverseProgress })
    const snapshot = makeSnapshot(merged.forward, language, { inverseProgress: merged.inverse, studyMode })
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot))
    return { ok: true, progress: merged.forward, inverseProgress: merged.inverse }
  } catch {
    return { ok: false, progress, inverseProgress }
  }
}

export function restoreBackup(progress, language, deck, options) {
  try {
    // Validation happens before replacement; corrupt existing data stays intact until this explicit action.
    const snapshot = validateSnapshot(makeSnapshot(progress, language, options), deck)
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(makeSnapshot(snapshot.progress, snapshot.language, snapshot)))
    return true
  } catch { return false }
}

export function dueCards(deck, progress, now) {
  return deck.filter(card => (progress[card.id]?.dueAt ?? 0) <= now).sort((a, b) => {
    const left = progress[a.id], right = progress[b.id]
    // Review previously studied, due cards before introducing new phrases.
    if (Boolean(left?.reviews) !== Boolean(right?.reviews)) return left?.reviews ? -1 : 1
    // Keep older overdue days first; retain the supplied mix within the same day.
    if (!left?.reviews) return 0
    const leftDay = new Date(left.dueAt).setHours(0, 0, 0, 0)
    const rightDay = new Date(right.dueAt).setHours(0, 0, 0, 0)
    return leftDay - rightDay
  })
}
