'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function useRouteFocus(targetId = 'main-content'): void {
  const pathname = usePathname()
  const isInitialRun = useRef(true)

  useEffect(() => {
    if (isInitialRun.current) {
      isInitialRun.current = false
      return
    }
    if (typeof document === 'undefined') return

    const target = document.getElementById(targetId)
    if (!target) return
    if (target.contains(document.activeElement)) return

    target.focus({ preventScroll: true })
  }, [pathname, targetId])
}
