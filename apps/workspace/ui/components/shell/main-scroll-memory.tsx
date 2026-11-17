'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const offsets = new Map<string, number>()
const MAX_REMEMBERED = 50
const RESTORE_FRAMES = 60

const currentKey = (): string => `${window.location.pathname}${window.location.search}`

function remember(key: string, top: number): void {
  offsets.delete(key)
  offsets.set(key, top)
  if (offsets.size > MAX_REMEMBERED) {
    const oldest = offsets.keys().next().value
    if (oldest !== undefined) offsets.delete(oldest)
  }
}

export function MainScrollMemory({ targetId = 'main-content' }: { targetId?: string }): null {
  const pathname = usePathname()
  const traversing = useRef(false)
  const restoring = useRef(false)
  const firstRun = useRef(true)

  useEffect(() => {
    const main = document.getElementById(targetId)
    if (!main) return
    let frame = 0
    const onScroll = (): void => {
      if (traversing.current || frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        remember(currentKey(), main.scrollTop)
      })
    }
    let unclaimed = 0
    const onPopState = (): void => {
      traversing.current = true
      window.clearTimeout(unclaimed)
      unclaimed = window.setTimeout(() => {
        if (!restoring.current) traversing.current = false
      }, 1000)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('popstate', onPopState)
    return () => {
      main.removeEventListener('scroll', onScroll)
      window.removeEventListener('popstate', onPopState)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(unclaimed)
    }
  }, [targetId])

  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!traversing.current) return
    const main = document.getElementById(targetId)
    if (!main) {
      traversing.current = false
      return
    }
    const target = offsets.get(currentKey()) ?? 0
    let frames = 0
    let frame = 0
    restoring.current = true
    const stop = (): void => {
      window.cancelAnimationFrame(frame)
      restoring.current = false
      traversing.current = false
      for (const type of ['wheel', 'touchstart', 'keydown'] as const) main.removeEventListener(type, stop)
    }
    const apply = (): void => {
      main.scrollTop = target
      frames += 1
      const reached = Math.abs(main.scrollTop - target) < 1
      if (reached || frames >= RESTORE_FRAMES) {
        stop()
        return
      }
      frame = window.requestAnimationFrame(apply)
    }
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
      main.addEventListener(type, stop, { passive: true })
    }
    apply()
    return stop
  }, [pathname, targetId])

  return null
}
