export function swipeAxis(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'pending'
  if (Math.abs(dy) >= Math.abs(dx) * 1.1) return 'vertical'
  return Math.abs(dx) >= Math.abs(dy) * 1.3 ? 'horizontal' : 'pending'
}

export function swipeThreshold(width) {
  return Math.max(48, Math.min(80, width * 0.25))
}

export function swipeAnswer(dx, dy, width) {
  if (swipeAxis(dx, dy) !== 'horizontal' || Math.abs(dx) < swipeThreshold(width)) return null
  return dx > 0 ? 'remembered' : 'again'
}
