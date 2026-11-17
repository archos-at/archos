'use client'

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { isSettlingStatus } from '../components/document-status'
import type { FileItem } from '../components/project-file-workspace'
import {
  mergeStatusReads,
  nextStatusBatch,
  readDocumentStatuses,
  type DocumentStatusRead,
} from '../lib/document-status-reads'

interface HeldRead {
  at: number
  read: DocumentStatusRead
}

export interface SettlingStatusReads<T extends FileItem> {
  tick: () => Promise<void>
  beginLoad: () => (rows: T[]) => T[]
}

export function useSettlingStatusReads<T extends FileItem>(
  files: readonly T[],
  setFiles: Dispatch<SetStateAction<T[]>>,
  { fetcher }: { fetcher?: typeof fetch } = {}
): SettlingStatusReads<T> {
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])
  const sequence = useRef(0)
  const offset = useRef(0)
  const held = useRef(new Map<string, HeldRead>())

  const tick = useCallback(async () => {
    const settling = filesRef.current.filter((file) => isSettlingStatus(file.status)).map((file) => file.id)
    if (settling.length === 0) return
    const { batch, next } = nextStatusBatch(settling, offset.current)
    offset.current = next
    const at = ++sequence.current
    const reads = await readDocumentStatuses(batch, { fetcher })
    if (reads.size === 0) return
    for (const [id, read] of reads) held.current.set(id, { at, read })
    setFiles((previous) => mergeStatusReads(previous, reads))
  }, [setFiles, fetcher])

  const beginLoad = useCallback(() => {
    const at = ++sequence.current
    return (rows: T[]) => {
      const newer = new Map<string, DocumentStatusRead>()
      for (const [id, entry] of held.current) {
        if (entry.at > at) newer.set(id, entry.read)
        else held.current.delete(id)
      }
      return mergeStatusReads(rows, newer)
    }
  }, [])

  return { tick, beginLoad }
}
