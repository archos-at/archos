'use client'

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { fetchDocumentRow } from '@/lib/documents/level-client'
import { toFileItem, type DocumentWireRow } from '../lib/file-item'
import type { FileItem } from '../file-types'

export interface LinkedDocumentsOptions {
  known: readonly FileItem[]
  ids: readonly (string | null | undefined)[]
  byName?: { name: string | null; resolve: (name: string) => Promise<DocumentWireRow[]> }
  fetcher?: typeof fetch
}

export interface LinkedDocuments {
  files: FileItem[]
  setFiles: Dispatch<SetStateAction<FileItem[]>>
  settled: boolean
}

export function useLinkedDocuments({ known, ids, byName, fetcher }: LinkedDocumentsOptions): LinkedDocuments {
  const [files, setFiles] = useState<FileItem[]>([])
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())

  const knownIds = useMemo(() => new Set(known.map((file) => file.id)), [known])
  const missingKey = useMemo(
    () =>
      [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
        .filter((id) => !knownIds.has(id))
        .sort()
        .join(','),
    [ids, knownIds]
  )

  useEffect(() => {
    const wanted = missingKey === '' ? [] : missingKey.split(',').filter((id) => !answered.has(id))
    if (wanted.length === 0) return
    const controller = new AbortController()
    void Promise.all(
      wanted.map((id) =>
        fetchDocumentRow(id, { signal: controller.signal, fetcher })
          .then((row) => ({ id, row, answered: true }))
          .catch(() => ({ id, row: null, answered: false }))
      )
    ).then((results) => {
      if (controller.signal.aborted) return
      const found = results.flatMap(({ row }) => (row ? [toFileItem(row)] : []))
      if (found.length > 0) {
        setFiles((previous) => [...previous.filter((file) => !found.some((row) => row.id === file.id)), ...found])
      }
      const settledIds = results.filter((result) => result.answered).map(({ id }) => id)
      if (settledIds.length > 0) setAnswered((previous) => new Set([...previous, ...settledIds]))
    })
    return () => controller.abort()
  }, [missingKey, answered, fetcher])

  const modelName = byName?.name ?? null
  const resolveByName = byName?.resolve
  const nameKnown = modelName !== null && (known.some((file) => file.filename === modelName) || files.some((file) => file.filename === modelName))
  useEffect(() => {
    if (modelName === null || nameKnown || !resolveByName) return
    let cancelled = false
    resolveByName(modelName)
      .then((rows) => {
        if (cancelled) return
        const found = rows.filter((row) => row.filename === modelName).map(toFileItem)
        if (found.length > 0) setFiles((previous) => [...previous, ...found.filter((row) => !previous.some((file) => file.id === row.id))])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [modelName, nameKnown, resolveByName])

  const settled = missingKey === '' || missingKey.split(',').every((id) => answered.has(id) || files.some((file) => file.id === id))
  const pinned = useMemo(() => files.filter((file) => !knownIds.has(file.id)), [files, knownIds])

  return { files: pinned, setFiles, settled }
}
