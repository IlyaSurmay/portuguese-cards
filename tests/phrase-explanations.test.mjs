import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => JSON.parse(readFileSync(new URL(`../src/${name}.json`, import.meta.url)))
const deck = read('tatabogatacards')
const explanations = read('phrase-explanations')

test('every card has a complete explanation in both languages under its permanent ID', () => {
  assert.deepEqual(Object.keys(explanations).sort(), deck.map(card => card.id).sort())
  for (const card of deck) {
    const note = explanations[card.id]
    assert.ok(note.parts.length >= 2, card.id)
    for (const locale of ['uk', 'ru']) {
      for (const value of [note.grammar[locale], note.example[locale], ...note.parts.map(part => part[locale])]) {
        assert.equal(typeof value, 'string', card.id)
        assert.ok(value.trim().length > 0, card.id)
        assert.match(value, /[а-яіїєґё]/iu, card.id)
        assert.doesNotMatch(value, /TODO|TBD|placeholder|lorem ipsum/i, card.id)
      }
    }
  }
})

test('building blocks quote the actual phrase and each example adds a different sentence', () => {
  const examples = new Set()
  for (const card of deck) {
    const note = explanations[card.id]
    const chunks = new Set()
    for (const { pt } of note.parts) {
      assert.ok(pt.trim(), card.id)
      assert.ok(card.portuguese.toLocaleLowerCase('pt').includes(pt.toLocaleLowerCase('pt')), `${card.id}: ${pt}`)
      assert.ok(!chunks.has(pt), `${card.id}: duplicate chunk`)
      chunks.add(pt)
    }
    assert.ok(note.example.pt.trim(), card.id)
    assert.notEqual(note.example.pt, card.portuguese, card.id)
    assert.ok(!examples.has(note.example.pt), `${card.id}: duplicate example`)
    examples.add(note.example.pt)
  }
})

test('source spelling issues are corrected in notes without breaking legacy phrase matching', () => {
  assert.ok(deck.find(card => card.id === 'pt-018').portuguese.includes('alégico'))
  assert.ok(deck.find(card => card.id === 'pt-079').portuguese.includes('rúbrica'))
  for (const locale of ['uk', 'ru']) {
    assert.ok(explanations['pt-018'].grammar[locale].includes('alérgico/alérgica'))
    assert.ok(explanations['pt-079'].grammar[locale].includes('rubrica'))
    assert.ok(explanations['pt-110'].grammar[locale].includes('meia hora'))
  }
})
