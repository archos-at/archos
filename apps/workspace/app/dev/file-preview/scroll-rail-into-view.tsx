import { useEffect } from 'react'

let scrolledIntoView = false

export function ScrollRailIntoView(): null {
  useEffect(() => {
    const timer = setInterval(() => {
      if (scrolledIntoView) return clearInterval(timer)
      const panel = document.querySelector('[data-testid="document-revisions"]')
      if (!panel) return
      panel.scrollIntoView({ block: 'start', behavior: 'instant' })
      const box = panel.getBoundingClientRect()
      if (box.top >= 0 && box.top < window.innerHeight) {
        scrolledIntoView = true
        clearInterval(timer)
      }
    }, 120)
    return () => clearInterval(timer)
  }, [])
  return null
}
