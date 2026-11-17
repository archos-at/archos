export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export function focusPanelUnderFinger(event: Event): void {
  if (event.defaultPrevented || !isCoarsePointer()) return
  event.preventDefault()
  const panel = event.currentTarget
  if (panel instanceof HTMLElement) panel.focus()
}
