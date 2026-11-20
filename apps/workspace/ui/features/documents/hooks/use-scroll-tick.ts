'use client'

import { useEffect, useState, type RefObject } from 'react'

export function useScrollTick(ref: RefObject<HTMLElement | null>): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let frame: number | null = null
    const onScroll = () => {
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null
          setTick((tick) => tick + 1)
        })
    }
    node.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll, { capture: true })
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [ref])
}
