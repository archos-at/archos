'use client'

import * as React from 'react'

export const SIDEBAR_PEEK_OPEN_MS = 90
export const SIDEBAR_PEEK_CLOSE_MS = 220
const PEEK_HELD_BY = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'

export function useSidebarPeek(
  enabled: boolean,
  peek: boolean,
  setPeek: (peek: boolean) => void,
): Pick<React.ComponentProps<'div'>, 'onPointerEnter' | 'onPointerLeave'> {
  const container = React.useRef<HTMLElement | null>(null)
  const timer = React.useRef<number | null>(null)
  const pending = React.useRef<boolean | null>(null)
  const cancel = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }, [])
  const schedule = React.useCallback(
    (ms: number, next: boolean) => {
      if (pending.current === next) return
      cancel()
      pending.current = next
      timer.current = window.setTimeout(() => {
        timer.current = null
        pending.current = null
        setPeek(next)
      }, ms)
    },
    [cancel, setPeek],
  )

  React.useEffect(() => {
    if (!enabled) {
      cancel()
      setPeek(false)
    }
    return cancel
  }, [enabled, cancel, setPeek])

  React.useEffect(() => {
    if (!peek) return
    let pointerInside = true
    const held = (): boolean => {
      const rail = container.current
      if (!rail) return false
      return rail.querySelector('[data-state="open"]') !== null || rail.querySelector(':focus-visible') !== null
    }
    const settle = (): void => {
      if (pointerInside || held()) cancel()
      else schedule(SIDEBAR_PEEK_CLOSE_MS, false)
    }
    const onMove = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      pointerInside = target !== null && (Boolean(container.current?.contains(target)) || target.closest(PEEK_HELD_BY) !== null)
      settle()
    }
    const onLeaveWindow = (): void => {
      pointerInside = false
      settle()
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('focusin', settle)
    document.documentElement.addEventListener('pointerleave', onLeaveWindow)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('focusin', settle)
      document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
    }
  }, [peek, cancel, schedule])

  if (!enabled) return {}
  return {
    onPointerEnter: (event) => {
      container.current = event.currentTarget
      if (event.pointerType !== 'touch') schedule(SIDEBAR_PEEK_OPEN_MS, true)
    },
    onPointerLeave: () => {
      if (!peek) cancel()
    },
  }
}
