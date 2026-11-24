'use client'

import { useEffect, useState } from 'react'

export function useComposerArriving(isAuthenticated: boolean): boolean {
  const [arrived, setArrived] = useState(isAuthenticated)
  useEffect(() => {
    if (isAuthenticated) setArrived(true)
  }, [isAuthenticated])
  return !arrived
}
