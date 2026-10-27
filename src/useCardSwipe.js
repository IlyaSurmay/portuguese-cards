import { useEffect, useRef, useState } from 'react'
import { swipeAnswer, swipeAxis, swipeThreshold } from './swipe'

export function useCardSwipe(cardId, enabled, onSwipe, onTap) {
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState(0)

  useEffect(() => { gesture.current = null; setOffset(0) }, [cardId, enabled])

  function release(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return {
    offset,
    ready: Math.abs(offset) >= swipeThreshold(gesture.current?.width ?? 300),
    handlers: {
      onPointerDown(event) {
        if (!event.isPrimary) { gesture.current = null; setOffset(0); return }
        suppressClick.current = false
        if (!enabled || event.button !== 0) return
        gesture.current = { pointerId: event.pointerId, cardId, x: event.clientX, y: event.clientY,
          width: event.currentTarget.getBoundingClientRect().width, axis: 'pending' }
      },
      onPointerMove(event) {
        const start = gesture.current
        if (!start || start.pointerId !== event.pointerId) return
        const dx = event.clientX - start.x, dy = event.clientY - start.y
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= 10) suppressClick.current = true
        if (start.axis === 'pending') start.axis = swipeAxis(dx, dy)
        if (start.axis === 'vertical') { gesture.current = null; setOffset(0); return }
        if (start.axis !== 'horizontal') return
        event.currentTarget.setPointerCapture(event.pointerId)
        setOffset(dx)
      },
      onPointerUp(event) {
        const start = gesture.current
        gesture.current = null
        setOffset(0)
        release(event)
        if (!start || start.pointerId !== event.pointerId || start.cardId !== cardId || !enabled) return
        const answer = start.axis === 'horizontal' ? swipeAnswer(event.clientX - start.x, event.clientY - start.y, start.width) : null
        if (answer) { suppressClick.current = true; onSwipe(answer) }
      },
      onPointerCancel(event) { gesture.current = null; setOffset(0); release(event) },
      onClick(event) {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); return }
        onTap()
      },
    },
  }
}
