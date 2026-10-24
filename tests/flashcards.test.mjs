import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { restoreCards, readSavedValue, saveValue } from '../src/flashcards.js'
import { languages } from '../src/translations.js'

const deck = JSON.parse(readFileSync(new URL('../src/tatabogatacards.json', import.meta.url)))

test('all 200 cards have both translations and an HTTPS pronunciation recording', () => {
  assert.equal(deck.length, 200)
  assert.equal(new Set(deck.map(card => card.portuguese)).size, deck.length)
  for (const card of deck) {
    for (const field of ['portuguese', 'ukrainian', 'russian']) {
      assert.ok(card[field]?.trim(), `Missing ${field}: ${card.portuguese}`)
    }
    assert.equal(new URL(card.audioSrc).protocol, 'https:')
  }
  assert.deepEqual(Object.keys(languages.uk).sort(), Object.keys(languages.ru).sort())
})

test('existing users receive current translations and audio without losing shuffled progress', () => {
  const savedCards = [
    { portuguese: deck[9].portuguese, originalIndex: 9, timesLearned: 3 },
    { portuguese: deck[0].portuguese, originalIndex: 0, timesLearned: 5, isLearned: true,
      russian: 'stale translation', audioSrc: 'stale recording' },
  ]
  const cards = restoreCards(deck, savedCards)
  assert.equal(cards.length, 200)
  assert.equal(cards[9].timesLearned, 3)
  assert.equal(cards[0].isLearned, true)
  assert.equal(cards[0].russian, deck[0].russian)
  assert.equal(cards[0].audioSrc, deck[0].audioSrc)
  assert.equal(cards[1].timesLearned, 0)
})

test('progress follows the phrase if the bundled order changes', () => {
  const savedCards = [{ ...deck[0], originalIndex: 0, timesLearned: 4 }]
  const cards = restoreCards([deck[1], deck[0]], savedCards)
  assert.equal(cards[0].timesLearned, 0)
  assert.equal(cards[1].timesLearned, 4)
  assert.equal(cards[1].originalIndex, 1)
})

test('malformed saves recover and legacy learned flags are preserved', () => {
  for (const invalid of [null, {}, 'broken', 42]) {
    assert.equal(restoreCards(deck, invalid).length, 200)
    assert.equal(restoreCards(deck, invalid)[0].timesLearned, 0)
  }
  const cards = restoreCards(deck, [
    null,
    { originalIndex: 0, isLearned: true },
    { originalIndex: 1, timesLearned: -3 },
    { originalIndex: 2, timesLearned: 'wrong' },
    { originalIndex: 3, timesLearned: 99 },
  ])
  assert.equal(cards[0].timesLearned, 5)
  assert.equal(cards[0].isLearned, true)
  assert.equal(cards[1].timesLearned, 0)
  assert.equal(cards[2].timesLearned, 0)
  assert.equal(cards[3].timesLearned, 5)
})

test('unavailable browser storage does not prevent studying', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('Storage disabled') },
  })
  try {
    assert.equal(readSavedValue('flashcards'), null)
    assert.doesNotThrow(() => saveValue('flashcards', deck))
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})
