'use client'

import { useEffect, useRef } from 'react'

export function useDocumentTitle(title: string | null): void {
  const restoreRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (title === null) return

    restoreRef.current = document.title
    document.title = title

    return () => {
      if (restoreRef.current !== null) {
        document.title = restoreRef.current
        restoreRef.current = null
      }
    }
  }, [title])
}
