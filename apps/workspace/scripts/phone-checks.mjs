// The phone gate's checks, run in the page by `a11y-audit.mjs --phone-only` under touch: `phone-h-overflow` (the page
// scrolls sideways) and `phone-touch-target` (a hit area under 44px: the larger of the box, an absolute ::after or
// ::before, and a wrapping label; inline links in text, disabled and hidden controls exempt, as WCAG 2.5.8).
export const MIN_TARGET_PX = 44

export function phoneFindings(min) {
  const vw = window.innerWidth
  const name = (el) => {
    const id = el.getAttribute('data-testid') || el.getAttribute('data-slot') || ''
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${text}"`
  }
  const findings = []

  const page = document.scrollingElement || document.documentElement
  if (page.scrollWidth > vw + 1) {
    let widest = null
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      if (box.width > 0 && box.right > vw + 1 && (!widest || box.right > widest.right)) widest = { el, right: box.right }
    }
    findings.push({ id: 'phone-h-overflow', count: 1, sample: widest ? `${name(widest.el)} to ${Math.round(widest.right)}px` : `${page.scrollWidth}px` })
  }

  const controls = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=radio],[role=option],[role=menuitem],[role=switch],[role=checkbox]'
  const small = []
  for (const el of document.querySelectorAll(controls)) {
    if (el.matches(':disabled,[aria-disabled="true"]') || el.closest('[aria-hidden="true"],[inert]')) continue
    const box = el.getBoundingClientRect()
    if (box.width <= 1 || box.height <= 1) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0) continue
    const parentText = el.parentElement?.textContent?.trim() ?? ''
    if (el.tagName === 'A' && style.display === 'inline' && parentText.length > (el.textContent?.trim().length ?? 0)) continue
    let width = box.width
    let height = box.height
    for (const pseudo of ['::after', '::before']) {
      const part = getComputedStyle(el, pseudo)
      if (part.content === 'none' || part.position !== 'absolute') continue
      width = Math.max(width, parseFloat(part.width) || 0)
      height = Math.max(height, parseFloat(part.height) || 0)
    }
    for (const label of el.labels ?? []) {
      const around = label.getBoundingClientRect()
      width = Math.max(width, around.width)
      height = Math.max(height, around.height)
    }
    if (width < min - 0.5 || height < min - 0.5) small.push(`${name(el)} ${Math.round(width)}x${Math.round(height)}`)
  }
  if (small.length) findings.push({ id: 'phone-touch-target', count: small.length, sample: small.slice(0, 3).join(' | ') })
  return findings
}
