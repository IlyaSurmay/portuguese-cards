export const PROGRESS_KEY = 'portuguese-cards-progress-v2'
export const BACKUP_APP = 'portuguese-cards'
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
    && Number.isSafeInteger(record.dueAt) && record.dueAt >= 0 && record.dueAt <= 8640000000000000
    && (record.lastReviewedAt === null || (Number.isSafeInteger(record.lastReviewedAt) && record.lastReviewedAt >= 0 && record.lastReviewedAt <= 8640000000000000))
}

// Only progress is persisted; phrases, translations and recordings always come from the current deck.
export function validateSnapshot(value, deck) {
  if (!value || value.app !== BACKUP_APP || value.version !== 2
    || !['uk', 'ru', 'en'].includes(value.language)
    || !value.progress || typeof value.progress !== 'object' || Array.isArray(value.progress)) {
    throw new Error('Invalid backup')
  }
  const known = new Set(deck.map(card => card.id))
  const progress = {}
  let skipped = 0
  for (const [id, record] of Object.entries(value.progress)) {
    if (!validRecord(record)) throw new Error('Invalid progress record')
    if (!known.has(id)) { skipped++; continue }
    progress[id] = {
      stage: record.stage, reviews: record.reviews, lapses: record.lapses,
      dueAt: record.dueAt, lastReviewedAt: record.lastReviewedAt,
    }
  }
  if (skipped && !Object.keys(progress).length) throw new Error('Backup belongs to another deck')
  return { progress, language: value.language, skipped }
}

export function makeSnapshot(progress, language) {
  return { app: BACKUP_APP, version: 2, language, progress }
}

// A newer lapse must win over an older success, even though its stage is lower.
export function mergeProgress(current, incoming) {
  const merged = { ...current }
  for (const [id, record] of Object.entries(incoming)) {
    const previous = merged[id]
    if (!previous || (record.lastReviewedAt ?? 0) >= (previous.lastReviewedAt ?? 0)) merged[id] = record
  }
  return merged
}

export function loadSession(deck) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (raw !== null) return { ...validateSnapshot(JSON.parse(raw), deck), issue: null, migrate: false }
    const legacy = localStorage.getItem('flashcards')
    const savedLanguage = localStorage.getItem('flashcards-language')
    let language = 'uk'
    try { if (savedLanguage && JSON.parse(savedLanguage) === 'ru') language = 'ru' } catch { /* Preferences do not invalidate progress. */ }
    return {
      progress: legacy === null ? {} : migrateLegacy(deck, JSON.parse(legacy)), language,
      issue: null, migrate: true,
    }
  } catch {
    // Keep unreadable data untouched. Export remains available for this session;
    // importing a valid backup is the explicit recovery path.
    return { progress: {}, language: 'uk', issue: 'read', migrate: false }
  }
}

export function saveSession(progress, language, deck) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const stored = raw === null ? {} : validateSnapshot(JSON.parse(raw), deck).progress
    const merged = mergeProgress(stored, progress)
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(makeSnapshot(merged, language)))
    return { ok: true, progress: merged }
  } catch {
    return { ok: false, progress }
  }
}

export function restoreBackup(progress, language, deck) {
  try {
    // Validation happens before replacement; corrupt existing data stays intact until this explicit action.
    const snapshot = validateSnapshot(makeSnapshot(progress, language), deck)
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(makeSnapshot(snapshot.progress, snapshot.language)))
    return true
  } catch { return false }
}

export function dueCards(deck, progress, now) {
  return deck.filter(card => (progress[card.id]?.dueAt ?? 0) <= now).sort((a, b) => {
    const left = progress[a.id], right = progress[b.id]
    // Review previously studied, due cards before introducing new phrases.
    if (Boolean(left?.reviews) !== Boolean(right?.reviews)) return left?.reviews ? -1 : 1
    return (left?.dueAt ?? 0) - (right?.dueAt ?? 0)
  })
}
