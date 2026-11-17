'use client'

import { useEffect, useState } from 'react'

const KEYBOARD_MIN_PX = 150
const ZOOM_EPSILON = 0.01

const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]'

export function isTypingTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.closest(OVERLAY_SELECTOR)) return false
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement) return !element.readOnly
  if (element instanceof HTMLInputElement)
    return !element.readOnly && !NON_TEXT_INPUTS.has(element.type)
  return false
}

export interface ViewportReading {
  layoutHeight: number
  visualHeight: number
  visualScale: number
  tallestLayoutHeight: number
  fieldFocused: boolean
}

export function keyboardIsUp(reading: ViewportReading): boolean {
  if (!reading.fieldFocused) return false
  const zoomed = Math.abs(reading.visualScale - 1) >= ZOOM_EPSILON
  if (!zoomed && reading.layoutHeight - reading.visualHeight > KEYBOARD_MIN_PX) return true
  return reading.tallestLayoutHeight - reading.layoutHeight > KEYBOARD_MIN_PX
}

export function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false)

  useEffect(() => {
    let frame = 0
    const tallest = new Map<number, number>()
    const update = (): void => {
      frame = 0
      const root = document.documentElement
      const layoutHeight = root.clientHeight
      const width = root.clientWidth
      const fieldFocused = isTypingTarget(document.activeElement)
      if (!fieldFocused) tallest.set(width, Math.max(tallest.get(width) ?? 0, layoutHeight))
      const viewport = window.visualViewport
      setUp(
        keyboardIsUp({
          layoutHeight,
          visualHeight: viewport?.height ?? layoutHeight,
          visualScale: viewport?.scale ?? 1,
          tallestLayoutHeight: tallest.get(width) ?? layoutHeight,
          fieldFocused,
        })
      )
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    return () => {
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

  return up
}
