import { useState, useEffect, useRef } from 'react'
import cardsData from './tatabogatacards.json'
import { readSavedValue, restoreCards, saveValue, shuffleCards } from './flashcards'
import { languages } from './translations'
import './App.css'

function App() {
  const [cards, setCards] = useState(() =>
    shuffleCards(restoreCards(cardsData, readSavedValue('flashcards')))
  )
  const [language, setLanguage] = useState(() =>
    readSavedValue('flashcards-language') === 'ru' ? 'ru' : 'uk'
  )
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [sortByProgress, setSortByProgress] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const audioRef = useRef(null)
  const text = languages[language]
  const currentCard = cards[currentCardIndex]
  const totalLearned = cards.filter(card => card.isLearned).length
  const progress = cards.length ? Math.round((totalLearned / cards.length) * 100) : 0

  useEffect(() => {
    saveValue('flashcards', cards)
  }, [cards])

  useEffect(() => {
    saveValue('flashcards-language', language)
    document.documentElement.lang = language
  }, [language])

  // Capture this card's audio element so navigation and unmount stop its playback.
  useEffect(() => {
    const audio = audioRef.current
    return () => { audio?.pause() }
  }, [currentCard?.originalIndex, showStats])

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setAudioError(false)
  }

  const advanceCard = (updatedCards = cards) => {
    stopAudio()
    setIsFlipped(false)
    const current = updatedCards[currentCardIndex]
    const remaining = updatedCards.filter(card => card.originalIndex !== current.originalIndex)
    setCards([...shuffleCards(remaining), current])
    setCurrentCardIndex(0)
  }

  const handlePrevious = () => {
    stopAudio()
    setIsFlipped(false)
    setCurrentCardIndex(prev => prev === 0 ? cards.length - 1 : prev - 1)
  }

  const handleLearned = () => {
    const updatedCards = cards.map(card => {
      if (card.originalIndex !== currentCard.originalIndex) return card
      const timesLearned = Math.min(5, card.timesLearned + 1)
      return { ...card, timesLearned, isLearned: timesLearned >= 5 }
    })
    advanceCard(updatedCards)
  }

  const toggleStats = () => {
    stopAudio()
    setShowStats(!showStats)
  }

  const handlePlayAudio = async () => {
    const audio = audioRef.current
    if (!audio || !currentCard.audioSrc) return
    if (!audio.paused) {
      stopAudio()
      return
    }
    setAudioError(false)
    try {
      audio.currentTime = 0
      await audio.play()
    } catch (error) {
      // Navigating away can abort a pending play request; this isn't a failure.
      if (audioRef.current === audio && error.name !== 'AbortError') {
        setIsPlaying(false)
        setAudioError(true)
      }
    }
  }

  const languageControl = (
    <label className="language-control">
      {text.language}
      <select value={language} onChange={event => setLanguage(event.target.value)}>
        <option value="uk" lang="uk">Українська</option>
        <option value="ru" lang="ru">Русский</option>
      </select>
    </label>
  )

  if (!currentCard) return <div>{text.loading}</div>

  if (showStats) {
    const displayCards = [...cards].sort((a, b) => {
      if (sortByProgress && b.timesLearned !== a.timesLearned) {
        return b.timesLearned - a.timesLearned
      }
      return a.originalIndex - b.originalIndex
    })

    return (
      <div className="app-container">
        <div className="controls">{languageControl}</div>
        <h2 className="stats-title">{text.learningProgress}</h2>
        <div className="stats-controls">
          <button
            onClick={() => setSortByProgress(!sortByProgress)}
            className={`sort-button ${sortByProgress ? 'active' : ''}`}
          >
            {sortByProgress ? text.originalOrder : text.sortProgress}
          </button>
          <button onClick={toggleStats} className="stats-button">
            {text.backToCards}
          </button>
        </div>
        <div className="stats-summary">
          <p>{text.totalCards}: {cards.length}</p>
          <p>{text.learnedCards}: {totalLearned}</p>
          <p>{text.progress}: {progress}%</p>
        </div>
        <div className="cards-list">
          {displayCards.map(card => (
            <div
              key={card.originalIndex}
              className={`card-stat ${card.isLearned ? 'learned' : ''}`}
            >
              <div className="card-stat-text">
                <p lang="pt-PT">{card.portuguese}</p>
                <p lang={language}>{card[text.field]}</p>
              </div>
              <div className="card-stat-progress">
                {text.progress}: {card.timesLearned}/5
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="controls">
        {languageControl}
        <button onClick={toggleStats} className="stats-button">
          {text.viewProgress}
        </button>
      </div>

      <div className="text-white">
        <div>{text.learnedCards}: {totalLearned} / {cards.length}</div>
        <div className="progress-text">{text.progress}: {progress}%</div>
      </div>

      <div className="flashcard-container">
        <button onClick={handlePrevious} className="side-button" aria-label={text.previous}>←</button>
        <button
          type="button"
          className={`flashcard ${isFlipped ? 'flipped' : ''}`}
          onClick={() => setIsFlipped(!isFlipped)}
          aria-label={text.flip}
          aria-describedby={isFlipped ? 'card-translation' : 'card-portuguese'}
          aria-pressed={isFlipped}
        >
          <span className="flashcard-inner">
            <span className="flashcard-front" aria-hidden={isFlipped}>
              <span id="card-portuguese" className="flashcard-text" lang="pt-PT">{currentCard.portuguese}</span>
            </span>
            <span className="flashcard-back" aria-hidden={!isFlipped}>
              <span id="card-translation" className="flashcard-text" lang={language}>{currentCard[text.field]}</span>
            </span>
          </span>
        </button>
        <button onClick={() => advanceCard()} className="side-button" aria-label={text.next}>→</button>
      </div>

      <div className="button-container">
        <audio
          key={currentCard.originalIndex}
          ref={audioRef}
          src={currentCard.audioSrc || undefined}
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => { setIsPlaying(false); setAudioError(true) }}
        />
        <button
          onClick={handlePlayAudio}
          className="play-audio-button"
          disabled={!currentCard.audioSrc}
          aria-pressed={isPlaying}
        >
          <span aria-hidden="true">{isPlaying ? '■' : '▶'}</span>{' '}
          {!currentCard.audioSrc ? text.audioUnavailable : isPlaying ? text.stopAudio : text.playAudio}
        </button>
        {audioError && <p className="audio-error" role="alert">{text.audioError}</p>}
      </div>

      <div className="button-container">
        <button
          onClick={handleLearned}
          className="learned-button"
          disabled={currentCard.isLearned}
        >
          {currentCard.isLearned ? text.learned : text.markLearned}
        </button>
      </div>
    </div>
  )
}

export default App
