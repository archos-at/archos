'use client'

import { useEffect, type Dispatch, type SetStateAction } from 'react'

const TYPING_SWEEP_MS = 1_000

export function useTypingExpiry(
  typingUntil: Record<string, number>,
  setTypingUntil: Dispatch<SetStateAction<Record<string, number>>>
): void {
  useEffect(() => {
    if (Object.keys(typingUntil).length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setTypingUntil((previous) => {
        const live = Object.entries(previous).filter(([, until]) => until > now)
        if (live.length === Object.keys(previous).length) return previous
        return Object.fromEntries(live)
      })
    }, TYPING_SWEEP_MS)
    return () => clearInterval(timer)
  }, [typingUntil, setTypingUntil])
}
