'use client'

import { useEffect, useRef } from 'react'

export function leftTheWindow(event: DragEvent): boolean {
  if (event.relatedTarget !== null) return false
  const { clientX: x, clientY: y } = event
  return x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight
}

export function useDragEnd(active: boolean, onEnd: () => void): void {
  const latest = useRef(onEnd)
  latest.current = onEnd
  useEffect(() => {
    if (!active) return
    const end = () => latest.current()
    const leave = (event: DragEvent) => {
      if (leftTheWindow(event)) end()
    }
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end, true)
    document.addEventListener('dragleave', leave, true)
    return () => {
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end, true)
      document.removeEventListener('dragleave', leave, true)
    }
  }, [active])
}
