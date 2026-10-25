const tenseLabels = {
  present: 'tensePresent', imperfect: 'tenseImperfect', preterite: 'tensePreterite',
  imperative: 'tenseImperative', negativeImperative: 'tenseNegativeImperative',
}

export function VerbNotes({ entries, data, language, text }) {
  return <>
    <p className="muted" lang={language}>{text.verbPronouns}</p>
    {entries.map(({ verb, form }) => {
      const info = data[verb]
      const explanation = info.forms[form]
      return <article className="verb-note" key={`${verb}:${form}`}>
        <h4><span lang="pt-PT">{form}</span> ← <span lang="pt-PT">{verb}</span></h4>
        <p className="verb-meaning" lang={language}>{info.meaning[language]}</p>
        <p className="verb-form-note" lang={language}>{explanation.note[language]}</p>
        <details className="verb-comparison">
          <summary>{text.compareVerbForms}</summary>
          {explanation.tables.map(tense => <table key={tense}>
            <caption>{text[tenseLabels[tense]]}</caption>
            <thead><tr><th scope="col">{text.verbSubject}</th><th scope="col">{text.verbForm}</th></tr></thead>
            <tbody>{info.tables[tense].map(([subject, conjugated]) => <tr key={subject} className={conjugated === form ? 'current-verb-form' : undefined}>
              <th scope="row" lang="pt-PT">{subject}</th><td lang="pt-PT">{conjugated}</td>
            </tr>)}</tbody>
          </table>)}
        </details>
      </article>
    })}
  </>
}
import PropTypes from 'prop-types'


const localized = PropTypes.shape({ en: PropTypes.string.isRequired, uk: PropTypes.string.isRequired, ru: PropTypes.string.isRequired })
VerbNotes.propTypes = {
  entries: PropTypes.arrayOf(PropTypes.shape({ verb: PropTypes.string.isRequired, form: PropTypes.string.isRequired })).isRequired,
  data: PropTypes.objectOf(PropTypes.shape({
    meaning: localized.isRequired,
    forms: PropTypes.objectOf(PropTypes.shape({ note: localized.isRequired, tables: PropTypes.arrayOf(PropTypes.string).isRequired })).isRequired,
    tables: PropTypes.objectOf(PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string))).isRequired,
  })).isRequired,
  language: PropTypes.oneOf(['en', 'uk', 'ru']).isRequired,
  text: PropTypes.objectOf(PropTypes.string).isRequired,
}
