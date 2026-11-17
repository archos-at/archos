'use client'

import { useCallback, useMemo, useState } from 'react'

export interface DocumentSelection {
  active: boolean
  selectedIds: ReadonlySet<string>
  start: (documentId?: string) => void
  toggle: (documentId: string) => void
  set: (documentIds: readonly string[]) => void
  exit: () => void
}

const NONE: ReadonlySet<string> = new Set()

export function useDocumentSelection(): DocumentSelection {
  const [active, setActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(NONE)

  const start = useCallback((documentId?: string) => {
    setActive(true)
    setSelectedIds(documentId === undefined ? NONE : new Set([documentId]))
  }, [])
  const toggle = useCallback((documentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (!next.delete(documentId)) next.add(documentId)
      return next
    })
  }, [])
  const set = useCallback(
    (documentIds: readonly string[]) => setSelectedIds(new Set(documentIds)),
    []
  )
  const exit = useCallback(() => {
    setActive(false)
    setSelectedIds(NONE)
  }, [])

  return useMemo(
    () => ({ active, selectedIds, start, toggle, set, exit }),
    [active, selectedIds, start, toggle, set, exit]
  )
}
