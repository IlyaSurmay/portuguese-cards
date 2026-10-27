import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKUP_APP, DAY, PROGRESS_KEY, dueCards, loadSession, makeSnapshot, mergeStudyProgress,
  newProgress, progressByMode, restoreBackup, reviewCard, saveSession, undoReview, validateSnapshot,
} from '../src/flashcards.js'

const deck = [{ id: 'pt-001', portuguese: 'Olá!' }, { id: 'pt-002', portuguese: 'Obrigado.' }]
const now = Date.UTC(2026, 9, 27, 12)
const reviewed = reviewCard(undefined, 'remembered', now)
const oldBackup = progress => ({ app: BACKUP_APP, version: 2, language: 'ru', progress })

function withStorage(initial, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map(initial === undefined ? [] : [[PROGRESS_KEY, JSON.stringify(initial)]])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try { run(storage) } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
}

test('version 2 saves migrate without altering Portuguese-first progress or language', () => {
  const progress = { 'pt-001': reviewed }
  withStorage(oldBackup(progress), () => {
    const session = loadSession(deck)
    assert.equal(session.issue, null)
    assert.equal(session.migrate, true)
    assert.equal(session.studyMode, 'forward')
    assert.equal(session.language, 'ru')
    assert.deepEqual(session.progress, progress)
    assert.deepEqual(session.inverseProgress, {})
    assert.equal(saveSession(session.progress, session.language, deck, session).ok, true)
    assert.equal(JSON.parse(localStorage.getItem(PROGRESS_KEY)).version, 3)
    const migrated = loadSession(deck)
    assert.equal(migrated.migrate, false)
    assert.deepEqual(migrated.progress, progress)
  })
})

test('new and legacy sessions start Portuguese first with empty inverse progress', () => {
  withStorage(undefined, storage => {
    assert.equal(loadSession(deck).studyMode, 'forward')
    assert.equal(loadSession(deck).language, 'en')
    storage.setItem('flashcards', JSON.stringify([{ ...deck[0], timesLearned: 4 }]))
    const legacy = loadSession(deck)
    assert.equal(legacy.progress['pt-001'].stage, 4)
    assert.deepEqual(legacy.inverseProgress, {})
    assert.equal(legacy.studyMode, 'forward')
  })
})

test('the same card has independent levels and due dates in each direction', () => {
  const forward = { 'pt-001': reviewed }
  const inverse = { 'pt-001': reviewCard(undefined, 'again', now) }
  assert.equal(dueCards(deck, forward, now).length, 1)
  assert.equal(dueCards(deck, {}, now).length, 2)
  assert.equal(dueCards(deck, inverse, now + 10 * 60000).length, 2)
  assert.equal(dueCards(deck, forward, now + 10 * 60000).length, 1)
  assert.equal(forward['pt-001'].stage, 1)
  assert.equal(inverse['pt-001'].stage, 0)
  assert.equal(forward['pt-001'].dueAt, now + DAY)
})

test('saving, exporting and restoring retain both directions and mode in all languages', () => {
  const forward = { 'pt-001': reviewed }
  const inverse = { 'pt-002': reviewCard(undefined, 'again', now + 10) }
  withStorage(undefined, () => {
    for (const language of ['en', 'uk', 'ru']) {
      for (const studyMode of ['forward', 'inverse']) {
        assert.equal(saveSession(forward, language, deck, { inverseProgress: inverse, studyMode }).ok, true)
        const session = loadSession(deck)
        assert.equal(session.studyMode, studyMode)
        assert.equal(session.language, language)
        assert.deepEqual(progressByMode(session), { forward, inverse })
        const backup = validateSnapshot(JSON.parse(JSON.stringify(makeSnapshot(session.progress, language, session))), deck)
        assert.equal(restoreBackup(backup.progress, backup.language, deck, backup), true)
        assert.deepEqual(progressByMode(loadSession(deck)), { forward, inverse })
        assert.equal(loadSession(deck).studyMode, studyMode)
      }
    }
  })
})

test('stale tab writes merge both directions independently, even for the same card', () => {
  const stale = reviewed
  const newer = reviewCard(stale, 'again', now + 100)
  const inverse = reviewCard(undefined, 'remembered', now + 200)
  withStorage(makeSnapshot({ 'pt-001': newer }, 'en', { inverseProgress: { 'pt-001': inverse }, studyMode: 'inverse' }), () => {
    const result = saveSession({ 'pt-001': stale, 'pt-002': reviewed }, 'uk', deck, { inverseProgress: {}, studyMode: 'forward' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.progress, { 'pt-001': newer, 'pt-002': reviewed })
    assert.deepEqual(result.inverseProgress, { 'pt-001': inverse })
    const fromEvent = progressByMode(loadSession(deck))
    const tab = { forward: { 'pt-001': stale }, inverse: { 'pt-002': reviewed } }
    assert.deepEqual(mergeStudyProgress(tab, fromEvent).inverse, { 'pt-002': reviewed, 'pt-001': inverse })
    assert.deepEqual(mergeStudyProgress(tab, fromEvent).forward['pt-001'], newer)
  })
})

test('merging an older backup never erases inverse progress', () => {
  const current = { forward: { 'pt-001': reviewed }, inverse: { 'pt-001': reviewed } }
  const incoming = progressByMode(validateSnapshot(oldBackup({ 'pt-002': reviewed }), deck))
  const merged = mergeStudyProgress(current, incoming)
  assert.deepEqual(merged.forward, { 'pt-001': reviewed, 'pt-002': reviewed })
  assert.deepEqual(merged.inverse, current.inverse)
})

test('Undo and stale merges restore only the original direction', () => {
  const inverseReview = reviewCard(undefined, 'again', now + 1)
  const restored = undoReview(inverseReview, inverseReview, undefined, now + 2)
  const current = { forward: { 'pt-001': reviewed }, inverse: { 'pt-001': inverseReview } }
  const undone = { forward: {}, inverse: { 'pt-001': restored } }
  const merged = mergeStudyProgress(current, undone)
  assert.deepEqual(merged.forward, current.forward)
  assert.deepEqual(merged.inverse['pt-001'], { ...newProgress(), updatedAt: now + 2 })
  assert.deepEqual(mergeStudyProgress(merged, current), merged)
})

test('invalid mode or inverse data rejects the whole backup before changing storage', () => {
  const good = makeSnapshot({ 'pt-001': reviewed }, 'en', { inverseProgress: { 'pt-002': reviewed }, studyMode: 'inverse' })
  const invalid = [
    { ...good, studyMode: 'mixed' }, { ...good, studyMode: undefined },
    { ...good, inverseProgress: undefined }, { ...good, inverseProgress: [] },
    { ...good, inverseProgress: { 'pt-002': { ...reviewed, stage: 7 } } },
    { ...good, inverseProgress: { 'pt-002': { ...reviewed, updatedAt: -1 } } },
    { ...good, version: 4 },
  ]
  withStorage(good, () => {
    const original = localStorage.getItem(PROGRESS_KEY)
    for (const snapshot of invalid) assert.throws(() => validateSnapshot(snapshot, deck))
    assert.equal(restoreBackup(good.progress, 'en', deck, { inverseProgress: [], studyMode: 'inverse' }), false)
    assert.equal(localStorage.getItem(PROGRESS_KEY), original)
  })
})

test('inverse-only backups are valid; unrelated cards are counted or rejected in both maps', () => {
  const snapshot = makeSnapshot({}, 'en', { inverseProgress: { 'pt-001': reviewed, 'unknown': reviewed }, studyMode: 'inverse' })
  const parsed = validateSnapshot(snapshot, deck)
  assert.equal(parsed.skipped, 1)
  assert.deepEqual(parsed.inverseProgress, { 'pt-001': reviewed })
  assert.throws(() => validateSnapshot({ ...snapshot, inverseProgress: { unknown: reviewed } }, deck))
})

test('failed writes retain both maps in memory for export and a safe retry', () => {
  withStorage(undefined, storage => {
    const forward = { 'pt-001': reviewed }, inverse = { 'pt-002': reviewed }
    const write = storage.setItem
    storage.setItem = () => { throw new Error('Full') }
    const result = saveSession(forward, 'ru', deck, { inverseProgress: inverse, studyMode: 'inverse' })
    assert.equal(result.ok, false)
    assert.deepEqual(progressByMode(result), { forward, inverse })
    assert.deepEqual(progressByMode(validateSnapshot(makeSnapshot(result.progress, 'ru', { inverseProgress: result.inverseProgress, studyMode: 'inverse' }), deck)), { forward, inverse })
    storage.setItem = write
    assert.equal(saveSession(result.progress, 'ru', deck, { inverseProgress: result.inverseProgress, studyMode: 'inverse' }).ok, true)
    assert.deepEqual(progressByMode(loadSession(deck)), { forward, inverse })
  })
})
