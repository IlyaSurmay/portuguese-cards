// Refresh card content from the bundled deck, keeping only saved learning progress.
// Older versions stored entire cards, so using those objects would hide new translations.
export function restoreCards(deck, savedCards) {
  const saved = Array.isArray(savedCards) ? savedCards.filter(Boolean) : []
  return deck.map((card, originalIndex) => {
    const progress = saved.find(savedCard => savedCard.portuguese === card.portuguese)
      ?? saved.find(savedCard => !savedCard.portuguese && savedCard.originalIndex === originalIndex)
    const count = progress?.timesLearned
    const timesLearned = progress?.isLearned ? 5
      : Number.isFinite(count) ? Math.max(0, Math.min(5, Math.floor(count))) : 0
    return { ...card, originalIndex, timesLearned, isLearned: timesLearned >= 5 }
  })
}

export function shuffleCards(cards) {
  const shuffled = [...cards]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function readSavedValue(key) {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}

export function saveValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Studying still works if browser storage is unavailable or full.
  }
}
