import { useEffect, useRef, type RefObject } from 'react'

export function keepTrigger(current: HTMLElement | null): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest('[data-review-card], [data-testid="review-aim"]')
    ? active
    : current
}

export function focusLost(): boolean {
  const active = document.activeElement
  return !active || active === document.body || (active instanceof HTMLElement && active.dataset.testid === 'document-review')
}

export function restoreFocus(trigger: Element | null): void {
  if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return
  if (focusLost()) trigger.focus({ preventScroll: true })
}

export function useFocusBackOnClose<T extends HTMLElement>(open: boolean): RefObject<T | null> {
  const control = useRef<T | null>(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) restoreFocus(control.current)
    wasOpen.current = open
  }, [open])
  return control
}
