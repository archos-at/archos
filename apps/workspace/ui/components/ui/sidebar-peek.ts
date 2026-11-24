'use client'

import * as React from 'react'

export const SIDEBAR_PEEK_OPEN_MS = 90
export const SIDEBAR_PEEK_CLOSE_MS = 220
const PEEK_HELD_BY = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'

export function useSidebarPeek(
  enabled: boolean,
  peek: boolean,
  setPeek: (peek: boolean) => void,
): Pick<React.ComponentProps<'div'>, 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'> {
  const container = React.useRef<HTMLElement | null>(null)
  const timer = React.useRef<number | null>(null)
  const after = React.useCallback(
    (ms: number | null, next: boolean) => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = ms === null ? null : window.setTimeout(() => setPeek(next), ms)
    },
    [setPeek],
  )

  React.useEffect(() => {
    if (!enabled) {
      after(null, false)
      setPeek(false)
    }
    return () => after(null, false)
  }, [enabled, after, setPeek])

  React.useEffect(() => {
    if (!peek) return
    const held = (): boolean => {
      const rail = container.current
      if (!rail) return false
      return rail.querySelector('[data-state="open"]') !== null || rail.querySelector(':focus-visible') !== null
    }
    const onMove = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const inside = target !== null && (container.current?.contains(target) || target.closest(PEEK_HELD_BY) !== null)
      after(inside || held() ? null : SIDEBAR_PEEK_CLOSE_MS, false)
    }
    document.addEventListener('pointermove', onMove)
    return () => document.removeEventListener('pointermove', onMove)
  }, [peek, after])

  if (!enabled) return {}
  return {
    onPointerEnter: (event) => {
      container.current = event.currentTarget
      if (event.pointerType !== 'touch') after(SIDEBAR_PEEK_OPEN_MS, true)
    },
    onPointerLeave: () => {
      if (!peek) after(null, false)
    },
    onFocus: (event) => {
      container.current = event.currentTarget
      if (event.target.matches(':focus-visible')) after(0, true)
    },
    onBlur: (event) => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      if (next instanceof Element && next.closest(PEEK_HELD_BY) !== null) return
      after(SIDEBAR_PEEK_CLOSE_MS, false)
    },
  }
}
