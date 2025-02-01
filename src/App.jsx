import { useState, useEffect } from 'react'
import cardsData from './tatabogatacards.json'
import './App.css'

function App() {
  const [cards, setCards] = useState([])
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [sortByProgress, setSortByProgress] = useState(false)

  // Initialize cards with learning progress and shuffle them
  useEffect(() => {
    const savedCards = localStorage.getItem('flashcards')
    let initialCards
    if (savedCards) {
      initialCards = JSON.parse(savedCards)
    } else {
      // Maintain original order in saved data by adding index
      initialCards = cardsData.map((card, index) => ({
        ...card,
        originalIndex: index,
        timesLearned: 0,
        isLearned: false
      }))
      localStorage.setItem('flashcards', JSON.stringify(initialCards))
    }
    // Shuffle cards on initial load
    const shuffledCards = [...initialCards].sort(() => Math.random() - 0.5)
    setCards(shuffledCards)
  }, [])

  // Save cards to localStorage whenever they change
  useEffect(() => {
    if (cards.length > 0) {
      localStorage.setItem('flashcards', JSON.stringify(cards))
    }
  }, [cards])

  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  const handleNext = () => {
    setIsFlipped(false)
    // Shuffle remaining cards when moving to next card
    const remainingCards = [...cards]
    const currentCard = remainingCards.splice(currentCardIndex, 1)[0]
    const shuffledRemaining = remainingCards.sort(() => Math.random() - 0.5)
    setCards([...shuffledRemaining, currentCard])
    setCurrentCardIndex(0)
  }

  const handlePrevious = () => {
    setIsFlipped(false)
    setCurrentCardIndex((prev) => 
      prev === 0 ? cards.length - 1 : prev - 1
    )
  }

  const handleLearned = () => {
    const updatedCards = cards.map((card, index) => {
      if (index === currentCardIndex) {
        const newTimesLearned = card.timesLearned + 1
        return {
          ...card,
          timesLearned: newTimesLearned,
          isLearned: newTimesLearned >= 5
        }
      }
      return card
    })
    setCards(updatedCards)
    handleNext()
  }

  const toggleStats = () => {
    setShowStats(!showStats)
  }

  if (cards.length === 0) return <div>Loading...</div>

  const currentCard = cards[currentCardIndex]
  const totalLearned = cards.filter(card => card.isLearned).length

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
              key={card.originalIndex} 
              className={`card-stat ${card.isLearned ? 'learned' : ''}`}
            >
              <div className="card-stat-text">
                <p>{card.portuguese}</p>
                <p>{card.russian}</p>
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
            <h2>{currentCard.russian}</h2>
            <div className="card-progress">
              Progress: {currentCard.timesLearned}/5
            </div>
          </div>
        </div>
      </div>

      <button 
        onClick={handleLearned} 
        className="learned-button"
        disabled={currentCard.isLearned}
      >
        {currentCard.isLearned ? 'Learned!' : 'Mark as Learned'}
      </button>
    </div>
  )
}

export default App
