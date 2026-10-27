import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AGAIN_DELAY, DAY, INTERVAL_DAYS, PROGRESS_KEY, dueCards, loadSession, makeSnapshot,
  mergeProgress, migrateLegacy, newProgress, restoreBackup, reviewCard, saveSession, validateSnapshot,
} from '../src/flashcards.js'
import { languages } from '../src/translations.js'

const deck = JSON.parse(readFileSync(new URL('../src/tatabogatacards.json', import.meta.url)))
const now = Date.UTC(2026, 9, 24, 12)
function storage(values = {}) {
  const data = new Map(Object.entries(values))
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value), data }
}
function withStorage(value, action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value })
  try { return action() } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
}

test('the deck has 200 permanent unique IDs, complete translations and HTTPS recordings', () => {
  assert.equal(deck.length, 200)
  assert.equal(new Set(deck.map(card => card.id)).size, 200)
  assert.equal(deck[0].id, 'pt-001')
  assert.equal(deck[199].id, 'pt-200')
  for (const card of deck) {
    assert.match(card.id, /^pt-\d{3}$/)
    for (const field of ['portuguese', ...Object.values(languages).map(text => text.field)]) assert.ok(card[field]?.trim())
    assert.equal(new URL(card.audioSrc).protocol, 'https:')
  }
  for (const text of Object.values(languages)) {
    assert.deepEqual(Object.keys(text).sort(), Object.keys(languages.uk).sort())
    for (const value of Object.values(text)) assert.ok(typeof value === 'string' && value.trim())
  }
})

test('all translation languages share progress and survive saving and backup restore', () => {
  const progress = { [deck[0].id]: reviewCard(undefined, 'remembered', now) }
  const fake = storage()
  withStorage(fake, () => {
    for (const language of ['uk', 'ru', 'en', 'ru']) {
      assert.equal(saveSession(progress, language, deck).ok, true)
      const session = loadSession(deck)
      assert.equal(session.issue, null)
      assert.equal(session.language, language)
      assert.deepEqual(session.progress, progress)
      const backup = validateSnapshot(JSON.parse(JSON.stringify(makeSnapshot(session.progress, language))), deck)
      assert.equal(restoreBackup(backup.progress, backup.language, deck), true)
      assert.deepEqual(loadSession(deck).progress, progress)
      assert.equal(loadSession(deck).language, language)
    }
  })
  assert.throws(() => validateSnapshot(makeSnapshot(progress, 'xx'), deck))
})

test('remembered reviews follow all six intervals and remain capped at 60 days', () => {
  let record = newProgress()
  for (const [index, days] of INTERVAL_DAYS.entries()) {
    record = reviewCard(record, 'remembered', now)
    assert.equal(record.stage, index + 1)
    assert.equal(record.reviews, index + 1)
    assert.equal(record.dueAt, now + days * DAY)
  }
  record = reviewCard(record, 'remembered', now)
  assert.equal(record.stage, 6)
  assert.equal(record.dueAt, now + 60 * DAY)
})

test('again resets the interval and schedules a ten-minute retry without erasing review history', () => {
  const before = { stage: 5, reviews: 9, lapses: 2, lastReviewedAt: now - DAY, dueAt: now }
  const record = reviewCard(before, 'again', now)
  assert.deepEqual(record, { stage: 0, reviews: 10, lapses: 3, lastReviewedAt: now, dueAt: now + AGAIN_DELAY, updatedAt: now })
  assert.equal(reviewCard(record, 'remembered', now + AGAIN_DELAY).dueAt, now + AGAIN_DELAY + DAY)
  assert.throws(() => reviewCard(record, 'invalid', now))
})

test('due cards include new phrases and prioritize previous reviews; future cards wait until due', () => {
  const progress = {
    [deck[0].id]: reviewCard(undefined, 'remembered', now),
    [deck[2].id]: reviewCard(undefined, 'again', now - AGAIN_DELAY),
  }
  const due = dueCards(deck, progress, now)
  assert.equal(due.length, 199)
  assert.equal(due[0].id, deck[2].id)
  assert.ok(!due.some(card => card.id === deck[0].id))
  assert.ok(dueCards(deck, progress, now + DAY).some(card => card.id === deck[0].id))
})

test('legacy migration preserves shuffled counts and learned cards, and keeps the original save', () => {
  const saved = [
    { ...deck[9], timesLearned: 3, originalIndex: 9 },
    { ...deck[0], timesLearned: 5, isLearned: true, originalIndex: 0 },
  ]
  const progress = migrateLegacy(deck, saved)
  assert.equal(progress[deck[9].id].stage, 3)
  assert.equal(progress[deck[0].id].stage, 5)
  assert.equal(progress[deck[0].id].dueAt, 0)
  const fake = storage({ flashcards: JSON.stringify(saved), 'flashcards-language': '"ru"' })
  withStorage(fake, () => {
    const session = loadSession(deck)
    assert.equal(session.language, 'ru')
    assert.equal(session.migrate, true)
    assert.equal(saveSession(session.progress, 'ru', deck).ok, true)
    assert.equal(fake.getItem('flashcards'), JSON.stringify(saved))
    assert.equal(JSON.parse(fake.getItem(PROGRESS_KEY)).version, 3)
  })
})

test('a phrase correction or deck reordering cannot disconnect saved progress', () => {
  const progress = { [deck[0].id]: reviewCard(undefined, 'remembered', now) }
  const edited = [{ ...deck[0], portuguese: 'Corrected phrase' }, deck[1]].reverse()
  const restored = validateSnapshot(makeSnapshot(progress, 'uk'), edited)
  assert.deepEqual(restored.progress[deck[0].id], progress[deck[0].id])
})

test('backups validate before restore and merge the newest review, including lapses', () => {
  const old = reviewCard(undefined, 'remembered', now)
  const newer = reviewCard(old, 'again', now + 100)
  const other = reviewCard(undefined, 'remembered', now + 200)
  const current = { [deck[0].id]: newer, [deck[1].id]: other }
  const backup = validateSnapshot(JSON.parse(JSON.stringify(makeSnapshot({ [deck[0].id]: old }, 'ru'))), deck)
  const merged = mergeProgress(current, backup.progress)
  assert.equal(merged[deck[0].id].stage, 0)
  assert.equal(merged[deck[1].id].stage, 1)
  assert.deepEqual(mergeProgress({ [deck[0].id]: old }, current), current)
  for (const invalid of [{}, { ...makeSnapshot({}, 'ru'), version: 1 }, makeSnapshot({ [deck[0].id]: { ...old, dueAt: -1 } }, 'ru')]) {
    assert.throws(() => validateSnapshot(invalid, deck))
  }
})

test('corrupt or unavailable storage is reported without silently overwriting it', () => {
  const fake = storage({ [PROGRESS_KEY]: '{broken' })
  withStorage(fake, () => {
    assert.equal(loadSession(deck).issue, 'read')
    assert.equal(fake.getItem(PROGRESS_KEY), '{broken')
    assert.equal(saveSession({}, 'uk', deck).ok, false)
    assert.equal(fake.getItem(PROGRESS_KEY), '{broken')
    assert.equal(restoreBackup({}, 'ru', deck), true)
    assert.equal(loadSession(deck).issue, null)
  })
  withStorage({ getItem() { throw new Error('Disabled') }, setItem() { throw new Error('Full') } }, () => {
    assert.equal(loadSession(deck).issue, 'read')
    assert.equal(saveSession({}, 'uk', deck).ok, false)
  })
})

test('saving another tab merges distinct cards and does not replace a newer review with stale data', () => {
  const newer = reviewCard(undefined, 'again', now + 20)
  const previous = reviewCard(undefined, 'remembered', now)
  const fake = storage({ [PROGRESS_KEY]: JSON.stringify(makeSnapshot({ [deck[0].id]: newer }, 'uk')) })
  withStorage(fake, () => {
    const result = saveSession({ [deck[0].id]: previous, [deck[1].id]: previous }, 'ru', deck)
    assert.equal(result.ok, true)
    assert.equal(result.progress[deck[0].id].stage, 0)
    assert.equal(Object.keys(result.progress).length, 2)
    assert.ok(!fake.getItem(PROGRESS_KEY).includes('portuguese"'))
  })
})
