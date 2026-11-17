'use client'

import { useEffect, useState } from 'react'

export function useRestedFor(movedAt: number | null, ms: number): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (movedAt === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, movedAt + ms - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [movedAt, ms])
  return movedAt !== null && now - movedAt > ms
}
