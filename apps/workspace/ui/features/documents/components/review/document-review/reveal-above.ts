const GAP_PX = 24

const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

export function revealAbove(target: HTMLElement, coverTop: number): () => void {
  const hiddenNow = () => target.getBoundingClientRect().bottom + GAP_PX - coverTop
  const scroller = hiddenNow() > 0 ? scrollerOf(target) : null
  if (!scroller) return () => {}
  const before = scroller.style.paddingBottom
  for (let tries = 0, hidden = hiddenNow(); tries < 3 && hidden > 0; tries += 1, hidden = hiddenNow()) {
    const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    if (room < hidden) {
      const padding = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      scroller.style.paddingBottom = `${padding + hidden - room}px`
    }
    scroller.scrollTop += hidden
  }
  return () => {
    scroller.style.paddingBottom = before
  }
}

export const SHOWN_MEASURE_SELECTOR =
  '[data-testid="measure-value"], [data-testid^="measure-kept-"][aria-pressed="true"]'
