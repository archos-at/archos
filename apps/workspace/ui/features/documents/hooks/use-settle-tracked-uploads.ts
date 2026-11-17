'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDocumentsStore } from '../store'
import type { TrackedFile } from '../types'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import {
  isJoblessIngesting,
  nextStatusBatch,
  readDocumentStatuses,
  trackedPatchFromStatus,
} from '../lib/document-status-reads'
import { useSettlingRefresh } from './use-settling-refresh'

interface ListedDocument {
  id: string
  status: string | null
  errorMessage?: string | null
  quarantine?: QuarantineVerdict | null
}

export function useSettleTrackedUploads(
  documents: readonly ListedDocument[],
  uploads: readonly TrackedFile[],
  { fetcher }: { fetcher?: typeof fetch } = {}
): void {
  const waiting = useMemo(() => uploads.filter(isJoblessIngesting), [uploads])

  useEffect(() => {
    if (waiting.length === 0) return
    const byId = new Map(documents.map((d) => [d.id, d]))
    const { updateTrackedFile } = useDocumentsStore.getState()
    for (const upload of waiting) {
      const row = byId.get(upload.serverFileId ?? '')
      const patch = row ? trackedPatchFromStatus(row.status, row.errorMessage, row.quarantine) : null
      if (patch) updateTrackedFile(upload.id, patch)
    }
  }, [documents, waiting])

  const unlisted = useMemo(() => {
    const listed = new Set(documents.map((d) => d.id))
    return waiting.filter((upload) => !listed.has(upload.serverFileId ?? ''))
  }, [documents, waiting])
  const unlistedRef = useRef(unlisted)
  useEffect(() => {
    unlistedRef.current = unlisted
  }, [unlisted])
  const offset = useRef(0)

  const readUnlisted = useCallback(async () => {
    const rows = unlistedRef.current
    const ids = rows.map((upload) => upload.serverFileId ?? '').filter(Boolean)
    if (ids.length === 0) return
    const { batch, next } = nextStatusBatch(ids, offset.current)
    offset.current = next
    const reads = await readDocumentStatuses(batch, { fetcher })
    const { trackedFiles, updateTrackedFile } = useDocumentsStore.getState()
    for (const upload of rows) {
      const read = reads.get(upload.serverFileId ?? '')
      if (read?.kind !== 'row') continue
      const current = trackedFiles.find((f) => f.id === upload.id)
      if (!current || !isJoblessIngesting(current)) continue
      const patch = trackedPatchFromStatus(read.fields.status, read.fields.errorMessage, read.fields.quarantine)
      if (patch) updateTrackedFile(upload.id, patch)
    }
  }, [fetcher])

  const pollItems = useMemo(() => unlisted.map(() => ({ status: null, pending: true })), [unlisted])
  useSettlingRefresh(pollItems, readUnlisted)
}
