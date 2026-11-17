'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'

export function useHeaderHeight(
  onHeight: ((heightPx: number) => void) | undefined
): (node: HTMLElement | null) => void {
  const callbackRef = useRef(onHeight)
  const observerRef = useRef<ResizeObserver | null>(null)

  useLayoutEffect(() => {
    callbackRef.current = onHeight
  }, [onHeight])

  return useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const report = () => {
      const height = node.getBoundingClientRect().height
      if (height > 0) callbackRef.current?.(height)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return
    observerRef.current = new ResizeObserver(report)
    observerRef.current.observe(node)
  }, [])
}
