'use client'

import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { RevisionCompare } from './revision-compare'
import type { CompareFile, CompareRegion, SourceLoader } from './types'

interface OpenState {
  older: CompareFile
  newer: CompareFile
  overlays: readonly CompareRegion[]
}

export interface RevisionCompareHandle {
  openRevisionCompare: (
    older: CompareFile,
    newer: CompareFile,
    overlays?: readonly CompareRegion[],
  ) => void
  closeRevisionCompare: (older: CompareFile, newer: CompareFile) => boolean
  compareElement: JSX.Element | null
}

export function useRevisionCompare(
  loadSource?: SourceLoader,
  options: { onOpenTextCompare?: (older: CompareFile, newer: CompareFile) => void } = {},
): RevisionCompareHandle {
  const { onOpenTextCompare } = options
  const [open, setOpen] = useState<OpenState | null>(null)
  const current = useRef<OpenState | null>(null)

  const openRevisionCompare = useCallback<RevisionCompareHandle['openRevisionCompare']>(
    (older, newer, overlays = []) => {
      current.current = { older, newer, overlays }
      setOpen(current.current)
    },
    [],
  )
  const close = useCallback(() => {
    current.current = null
    setOpen(null)
  }, [])
  const closeRevisionCompare = useCallback<RevisionCompareHandle['closeRevisionCompare']>(
    (older, newer) => {
      const shown = current.current
      if (!shown || shown.older.id !== older.id || shown.newer.id !== newer.id) return false
      close()
      return true
    },
    [close],
  )

  const compareElement = useMemo(
    () =>
      open ? (
        <RevisionCompare
          key={`${open.older.id}:${open.newer.id}`}
          older={open.older}
          newer={open.newer}
          overlays={open.overlays}
          loadSource={loadSource}
          onClose={close}
          onOpenTextCompare={
            onOpenTextCompare
              ? () => {
                  close()
                  onOpenTextCompare(open.older, open.newer)
                }
              : undefined
          }
        />
      ) : null,
    [open, close, loadSource, onOpenTextCompare],
  )

  return { openRevisionCompare, closeRevisionCompare, compareElement }
}
