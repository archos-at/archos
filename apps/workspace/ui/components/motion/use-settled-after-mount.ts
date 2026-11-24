'use client'

import { useEffect, useState } from 'react'

export function useSettledAfterMount(ready: boolean): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (settled) return
    const settle = (): void => setSettled(true)
    window.addEventListener('pointerdown', settle, true)
    window.addEventListener('keydown', settle, true)
    let outer = 0
    let inner = 0
    if (ready) outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(settle)
    })
    return () => {
      window.removeEventListener('pointerdown', settle, true)
      window.removeEventListener('keydown', settle, true)
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [ready, settled])
  return settled
}
