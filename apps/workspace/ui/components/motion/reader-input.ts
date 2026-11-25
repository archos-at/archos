'use client'

const IN_PLACE_WINDOW_MS = 1500

let lastInput: { at: number; href: string } | null = null

const hereNow = (): string => `${window.location.pathname}${window.location.search}`

const record = (): void => {
  lastInput = { at: performance.now(), href: hereNow() }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', record, true)
  window.addEventListener('keydown', record, true)
}

export function readerCausedThisInPlace(now: number = performance.now()): boolean {
  if (typeof window === 'undefined' || lastInput === null) return false
  return lastInput.href === hereNow() && now - lastInput.at <= IN_PLACE_WINDOW_MS
}
