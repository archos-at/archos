'use client'

import { useCallback, useEffect, useState } from 'react'

const BRIEF_STORAGE_KEY = 'files.brief.collapsed'

export function useBriefCollapsed(phone = false): readonly [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(true)
  useEffect(() => {
    if (phone) {
      setCollapsed(true)
      return
    }
    try {
      if (window.localStorage.getItem(BRIEF_STORAGE_KEY) === '0') setCollapsed(false)
    } catch {
      // Storage unavailable — the choice holds for this visit.
    }
  }, [phone])
  const select = useCallback(
    (next: boolean) => {
      setCollapsed(next)
      if (phone) return
      try {
        window.localStorage.setItem(BRIEF_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // As above.
      }
    },
    [phone]
  )
  return [collapsed, select] as const
}
