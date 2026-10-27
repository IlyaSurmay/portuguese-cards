import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY, PROGRESS_KEY, dueCards, loadSession, makeSnapshot, mergeProgress, newProgress,
  reviewCard, saveSession, undoReview, validateSnapshot,
} from '../src/flashcards.js'
import { mixDeck, studyDay } from '../src/studyQueue.js'
import { swipeAnswer, swipeAxis, swipeThreshold } from '../src/swipe.js'

const deck = Array.from({ length: 200 }, (_, index) => ({ id: `pt-${index + 1}` }))
const now = new Date(2026, 9, 27, 12).getTime()
const id = deck[0].id

test('a daily mix is stable, varies across days and manual mixes, and never mutates the deck', () => {
  const original = structuredClone(deck)
  const mixed = mixDeck(deck, '2026-10-27:0')
  assert.deepEqual(mixed, mixDeck(deck, '2026-10-27:0'))
  assert.notDeepEqual(mixed.slice(0, 10), mixDeck(deck, '2026-10-28:0').slice(0, 10))
  assert.notDeepEqual(mixed, mixDeck(deck, '2026-10-27:1'))
  assert.equal(new Set(mixed.map(card => card.id)).size, 200)
  assert.deepEqual([...mixed].map(card => card.id).sort(), deck.map(card => card.id).sort())
  assert.deepEqual(deck, original)
  assert.deepEqual(mixDeck([], 'day'), [])
  assert.equal(studyDay(now), studyDay(now + 1000))
})

test('older due days precede new cards; same-day reviews retain the daily mix rather than exact timestamp order', () => {
  const mixed = mixDeck(deck, '2026-10-27:0')
  const record = reviewCard(undefined, 'remembered', now - DAY)
  const progress = {
    [mixed[0].id]: { ...record, dueAt: now - DAY },
    [mixed[2].id]: { ...record, dueAt: now - DAY - 1000 },
    [mixed[3].id]: { ...record, dueAt: now - 2 * DAY },
    [mixed[4].id]: { ...record, dueAt: now + 1 },
  }
  const due = dueCards(mixed, progress, now)
  assert.deepEqual(due.slice(0, 3).map(card => card.id), [mixed[3].id, mixed[0].id, mixed[2].id])
  assert.ok(!due.some(card => card.id === mixed[4].id))
  assert.deepEqual(due.slice(3), mixed.filter(card => !progress[card.id]))
})

test('Undo restores the full prior review and wins over stale copies in either merge direction', () => {
  const previous = { stage: 4, reviews: 7, lapses: 2, dueAt: now - 1000, lastReviewedAt: now - DAY }
  const reviewed = reviewCard(previous, 'again', now)
  const restored = undoReview(reviewed, reviewed, previous, now + 1)
  assert.deepEqual(restored, { ...previous, updatedAt: now + 1 })
  assert.equal(mergeProgress({ [id]: reviewed }, { [id]: restored })[id], restored)
  assert.equal(mergeProgress({ [id]: restored }, { [id]: reviewed })[id], restored)
  const backup = validateSnapshot(JSON.parse(JSON.stringify(makeSnapshot({ [id]: restored }, 'en'))), deck)
  assert.deepEqual(backup.progress[id], restored)
})

test('Undo of the first answer restores an unstudied card and is safe even in the same millisecond', () => {
  const reviewed = reviewCard(undefined, 'remembered', now)
  const restored = undoReview(reviewed, reviewed, undefined, now)
  assert.deepEqual(restored, { ...newProgress(), updatedAt: now + 1 })
  assert.equal(dueCards([deck[0]], { [id]: restored }, now).length, 1)
  assert.equal(reviewCard(restored, 'remembered', now + 2).reviews, 1)
  assert.equal(reviewCard(restored, 'remembered', now + 2).stage, 1)
})

test('Undo cannot replace a different, newer review', () => {
  const reviewed = reviewCard(undefined, 'remembered', now)
  const newer = reviewCard(reviewed, 'again', now + 1)
  assert.equal(undoReview(newer, reviewed, undefined, now + 2), null)
  assert.equal(undoReview(undefined, reviewed, undefined, now + 2), null)
})

test('a saved Undo cannot be resurrected by a stale tab or by retrying a failed save', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const reviewed = reviewCard(undefined, 'remembered', now)
    const restored = undoReview(reviewed, reviewed, undefined, now + 1)
    assert.ok(saveSession({ [id]: reviewed }, 'en', deck).ok)
    const write = storage.setItem
    storage.setItem = () => { throw new Error('Storage full') }
    assert.equal(saveSession({ [id]: restored }, 'en', deck).ok, false)
    storage.setItem = write
    assert.ok(saveSession({ [id]: restored }, 'en', deck).ok)
    assert.ok(saveSession({ [id]: reviewed }, 'ru', deck).ok)
    assert.deepEqual(loadSession(deck).progress[id], restored)
    assert.ok(values.get(PROGRESS_KEY).includes('updatedAt'))
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('older backups remain valid; malformed change timestamps are rejected', () => {
  const previous = { stage: 1, reviews: 1, lapses: 0, dueAt: now, lastReviewedAt: now - DAY }
  assert.deepEqual(validateSnapshot(makeSnapshot({ [id]: previous }, 'uk'), deck).progress[id], previous)
  for (const updatedAt of [-1, null, now - 2 * DAY, 8640000000000001]) {
    assert.throws(() => validateSnapshot(makeSnapshot({ [id]: { ...previous, updatedAt } }, 'en'), deck))
  }
})

test('swipes grade only deliberate horizontal gestures; taps, scrolls and short drags do not', () => {
  assert.equal(swipeAxis(2, 3), 'pending')
  assert.equal(swipeAxis(10, 80), 'vertical')
  assert.equal(swipeAnswer(120, 5, 300), 'remembered')
  assert.equal(swipeAnswer(-120, 5, 300), 'again')
  assert.equal(swipeAnswer(20, 2, 300), null)
  assert.equal(swipeAnswer(80, 120, 300), null)
  assert.equal(swipeAnswer(0, 150, 300), null)
  assert.equal(swipeAnswer(50, 0, 190), 'remembered')
  assert.equal(swipeThreshold(800), 80)
  assert.equal(swipeThreshold(160), 48)
})
