'use client'

import { useEffect, useRef, type RefObject } from 'react'

const isTextEntry = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function usePanelFocus(
  open: boolean,
  initialFocusRef: RefObject<HTMLElement | null>,
): { restoreFocus: () => void } {
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(open)

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!justOpened) return
    if (typeof document === 'undefined') return

    const active = document.activeElement
    if (isTextEntry(active)) return

    openerRef.current = active instanceof HTMLElement ? active : null
    initialFocusRef.current?.focus()
  }, [open, initialFocusRef])

  const restoreFocus = useRef(() => {
    openerRef.current?.focus()
    openerRef.current = null
  }).current

  return { restoreFocus }
}
