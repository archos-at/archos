'use client'

import { useEffect, useState } from 'react'

export function useDebouncedValue(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === settled) return
    if (value === '') {
      setSettled('')
      return
    }
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs, settled])

  return settled
}
