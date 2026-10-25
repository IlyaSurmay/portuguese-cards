import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { languages } from '../src/translations.js'

const read = name => JSON.parse(readFileSync(new URL(`../src/${name}.json`, import.meta.url)))
const deck = read('tatabogatacards')
const explanations = read('phrase-explanations')
const verbs = read('verb-explanations')

test('every card has a complete explanation in every translation language under its permanent ID', () => {
  assert.deepEqual(Object.keys(explanations).sort(), deck.map(card => card.id).sort())
  for (const card of deck) {
    const note = explanations[card.id]
    assert.ok(note.parts.length >= 2, card.id)
    for (const locale of Object.keys(languages)) {
      for (const value of [note.grammar[locale], note.example[locale], ...note.parts.map(part => part[locale]), ...(note.structure ? [note.structure[locale]] : [])]) {
        assert.equal(typeof value, 'string', card.id)
        assert.ok(value.trim().length > 0, card.id)
        assert.match(value, locale === 'en' ? /[a-z]/iu : /[а-яіїєґё]/iu, card.id)
        if (locale === 'en') assert.doesNotMatch(value, /[а-яіїєґё]/iu, card.id)
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
  for (const locale of Object.keys(languages)) {
    assert.ok(explanations['pt-018'].grammar[locale].includes('alérgico/alérgica'))
    assert.ok(explanations['pt-079'].grammar[locale].includes('rubrica'))
    assert.ok(explanations['pt-110'].grammar[locale].includes('meia hora'))
  }
})

test('every phrase adds localized verb analysis or explains its non-verbal structure', () => {
  const used = new Set()
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const card of deck) {
    const note = explanations[card.id]
    assert.ok(Array.isArray(note.verbs), card.id)
    assert.equal(new Set(note.verbs.map(({ verb, form }) => `${verb}:${form}`)).size, note.verbs.length, card.id)
    if (!note.verbs.length) {
      for (const locale of Object.keys(languages)) assert.ok(note.structure?.[locale]?.length > 80, card.id)
    }
    for (const { verb, form } of note.verbs) {
      assert.match(card.portuguese, new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, 'iu'), `${card.id}: ${form}`)
      const entry = verbs[verb]?.forms[form]
      assert.ok(entry, `${card.id}: ${verb}:${form}`)
      used.add(`${verb}:${form}`)
      assert.ok(entry.tables.length > 0)
      for (const table of entry.tables) assert.ok(verbs[verb].tables[table], `${verb}:${table}`)
    }
  }
  const declared = Object.entries(verbs).flatMap(([verb, info]) => Object.keys(info.forms).map(form => `${verb}:${form}`))
  assert.deepEqual([...used].sort(), declared.sort(), 'every catalog form should be used by a card')
})

test('verb meanings, personal-form notes and comparison tables are complete in all languages', () => {
  for (const [verb, info] of Object.entries(verbs)) {
    for (const locale of Object.keys(languages)) {
      const values = [info.meaning[locale], ...Object.values(info.forms).map(form => form.note[locale])]
      for (const value of values) {
        assert.equal(typeof value, 'string', `${verb}:${locale}`)
        assert.match(value, locale === 'en' ? /[a-z]/iu : /[а-яіїєґё]/iu, `${verb}:${locale}`)
        assert.doesNotMatch(value, /TODO|TBD|placeholder|undefined/i, verb)
      }
      for (const entry of Object.values(info.forms)) assert.ok(entry.note[locale].length > 100, `${verb}:${locale}`)
    }
    for (const [tense, table] of Object.entries(info.tables)) {
      assert.ok(['present', 'imperfect', 'preterite', 'imperative', 'negativeImperative'].includes(tense), verb)
      assert.ok(table.length > 0)
      assert.equal(new Set(table.map(([person]) => person)).size, table.length, verb)
      for (const row of table) assert.ok(row.length === 2 && row.every(value => typeof value === 'string' && value.trim()), verb)
    }
  }
})

test('irregular forms, ambiguous past forms and commands use the right conjugation paradigms', () => {
  assert.deepEqual(verbs.poder.tables.present.map(row => row[1]), ['posso', 'podes', 'pode', 'podemos', 'podem'])
  assert.deepEqual(verbs.subir.tables.present.map(row => row[1]), ['subo', 'sobes', 'sobe', 'subimos', 'sobem'])
  assert.equal(verbs.descer.tables.present[0][1], 'desço')
  assert.equal(verbs.ter.tables.present[4][1], 'têm')
  for (const locale of Object.keys(languages)) {
    assert.ok(verbs.poder.forms.posso.note[locale].includes('poss-'))
    assert.match(verbs.poder.forms.podia.note[locale], /\beu\b/iu)
    assert.ok(verbs.poder.forms.podia.note[locale].includes('você'))
    assert.ok(verbs.ver.forms['vemo-nos'].note[locale].includes('vemos + nos'))
  }
  assert.deepEqual(verbs.terminar.forms.terminamos.tables, ['present', 'preterite'])
  assert.deepEqual(verbs.mandar.forms.manda.tables, ['imperative'])
  assert.deepEqual(verbs['preocupar-se'].tables.negativeImperative[0], ['tu', 'não te preocupes'])
  assert.deepEqual(verbs['preocupar-se'].tables.negativeImperative[1], ['você / o senhor / a senhora', 'não se preocupe'])
  assert.deepEqual(verbs.haver.tables.present, [['impessoal', 'há']])
})
