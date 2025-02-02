import { useState, useEffect, useRef } from 'react'
import cardsData from './tatabogatacards.json'
import './App.css'

function App() {
  const [cards, setCards] = useState([])
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [sortByProgress, setSortByProgress] = useState(false)
  const audioRef = useRef(new Audio())

  // Initialize cards with learning progress and shuffle them haha
  useEffect(() => {
    const savedCards = localStorage.getItem('flashcards')
    let initialCards
    if (savedCards) {
      initialCards = JSON.parse(savedCards)
      // Ensure all cards have timesLearned property
      initialCards = initialCards.map(card => ({
        ...card,
        timesLearned: card.timesLearned || 0,
        isLearned: card.isLearned || false
      }))
    } else {
      initialCards = cardsData.map((card, index) => ({
        ...card,
        originalIndex: index,
        timesLearned: 0,
        isLearned: false
      }))
      localStorage.setItem('flashcards', JSON.stringify(initialCards))
    }
    const shuffledCards = [...initialCards].sort(() => Math.random() - 0.5)
    setCards(shuffledCards)
  }, [])

  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  const handleNext = () => {
    setIsFlipped(false)
    // Reset audio when switching cards
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    
    // Get fresh cards from localStorage
    const storedCards = JSON.parse(localStorage.getItem('flashcards'))
    
    // Find current card in stored cards
    const currentStoredCard = storedCards.find(
      card => card.originalIndex === cards[currentCardIndex].originalIndex
    )
    
    // Remove current card and shuffle remaining
    const remainingCards = storedCards.filter(
      card => card.originalIndex !== cards[currentCardIndex].originalIndex
    )
    const shuffledRemaining = remainingCards.sort(() => Math.random() - 0.5)
    
    // Add current card to the end
    const finalCards = [...shuffledRemaining, currentStoredCard]
    
    // Update localStorage and state
    localStorage.setItem('flashcards', JSON.stringify(finalCards))
    setCards(finalCards)
    setCurrentCardIndex(0)
  }

  const handlePrevious = () => {
    setIsFlipped(false)
    // Reset audio when switching cards
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setCurrentCardIndex((prev) => 
      prev === 0 ? cards.length - 1 : prev - 1
    )
  }

  const handleLearned = () => {
    // Get fresh cards from localStorage to ensure we have latest state
    const storedCards = JSON.parse(localStorage.getItem('flashcards'))
    
    // Update the specific card
    const updatedCards = storedCards.map((card) => {
      if (card.originalIndex === cards[currentCardIndex].originalIndex) {
        const newTimesLearned = (card.timesLearned || 0) + 1
        return {
          ...card,
          timesLearned: newTimesLearned,
          isLearned: newTimesLearned >= 5
        }
      }
      return card
    })

    // Save to localStorage first
    localStorage.setItem('flashcards', JSON.stringify(updatedCards))
    
    // Then update state
    setCards(updatedCards)
    
    // Move to next card
    handleNext()
  }

  const toggleStats = () => {
    setShowStats(!showStats)
  }

  if (cards.length === 0) return <div>Loading...</div>

  const currentCard = cards[currentCardIndex]
  const totalLearned = cards.filter(card => card.isLearned).length

  const handlePlayAudio = () => {
    if (audioRef.current) {
      audioRef.current.src = currentCard.audioSrc
      audioRef.current.play()
    }
  }

  if (showStats) {
    // Sort cards for display while maintaining original data order
    const displayCards = [...cards].sort((a, b) => {
      if (sortByProgress) {
        // Sort by times learned (descending) and then by original index
        if (b.timesLearned !== a.timesLearned) {
          return b.timesLearned - a.timesLearned
        }
      }
      return a.originalIndex - b.originalIndex
    })

    return (
      <div className="app-container">
        <h2>Learning Progress</h2>
        <div className="stats-controls">
          <button 
            onClick={() => setSortByProgress(!sortByProgress)}
            className={`sort-button ${sortByProgress ? 'active' : ''}`}
          >
            {sortByProgress ? 'Show Original Order' : 'Sort by Progress'}
          </button>
          <button onClick={toggleStats} className="stats-button">
            Back to Cards
          </button>
        </div>
        <div className="stats-summary">
          <p>Total cards: {cards.length}</p>
          <p>Learned cards: {totalLearned}</p>
          <p>Progress: {Math.round((totalLearned / cards.length) * 100)}%</p>
        </div>
        <div className="cards-list">
          {displayCards.map((card) => (
            <div 
              key={`${card.originalIndex}-${card.portuguese}`}
              className={`card-stat ${card.isLearned ? 'learned' : ''}`}
            >
              <div className="card-stat-text">
                <p>{card.portuguese}</p>
                <p>{card.ukrainian}</p>
              </div>
              <div className="card-stat-progress">
                Progress: {card.timesLearned}/5
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
        <button onClick={handlePrevious}>Previous</button>
        <button onClick={handleNext}>Next</button>
        <button onClick={toggleStats} className="stats-button">
          View Progress
        </button>
      </div>

      <div className="progress">
        Learned: {totalLearned} of {cards.length}
      </div>

      <div 
        className={`flashcard ${isFlipped ? 'flipped' : ''}`} 
        onClick={handleFlip}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front">
            <h2>{currentCard.portuguese}</h2>
            <div className="card-progress">
              Progress: {currentCard.timesLearned}/5
            </div>
          </div>
          <div className="flashcard-back">
            <h2>{currentCard.ukrainian}</h2>
            <div className="card-progress">
              Progress: {currentCard.timesLearned}/5
            </div>
          </div>
        </div>
      </div>

      <div className="button-container">
        <button 
          onClick={handleLearned} 
          className="learned-button"
          disabled={currentCard.isLearned}
        >
          {currentCard.isLearned ? 'Learned!' : 'Mark as Learned'}
        </button>
      </div>

      <div className="button-container">
        <button onClick={handlePlayAudio} className="play-audio-button">
          Play Audio
        </button>
      </div>
    </div>
  )
}

export default App
