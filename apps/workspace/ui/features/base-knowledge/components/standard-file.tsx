'use client'

/**
 * A standard opened as what it is, a file: the app's one viewer
 * (`FilePreviewDialog`, as the Büroablage opens it) with the standard's facts
 * first in its details column. The file is read the way every door into the
 * viewer reads it (`GET /api/documents/{id}/status`), so it is the same file,
 * named and screened the same, wherever it is opened.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { BaseKnowledgeEntry } from '@/adapters/api/base-knowledge-client'
import { FilePreviewDialog, fileItemFromStatus, type FileItem } from '@/features/documents/file-preview'
import { Spinner } from '@/components/ui/spinner'
import { StandardFacts } from './standard-facts'

interface StandardFileProps {
  entry: BaseKnowledgeEntry
  canManage: boolean
  onClose: () => void
  onManage: () => void
  onOpenEdition: (entryId: string) => void
  onChanged: (entry: BaseKnowledgeEntry | null) => void
  /** The file could not be read (gone, or not this reader's to see). */
  onUnavailable: () => void
}

type StatusBody = Parameters<typeof fileItemFromStatus>[0]

export function StandardFile({ entry, canManage, onClose, onManage, onOpenEdition, onChanged, onUnavailable }: StandardFileProps): JSX.Element {
  const [file, setFile] = useState<FileItem | null>(null)
  const documentId = entry.documentId
  // Read once per document: a changed entry (a check, a confirmation) keeps the file on screen.
  const fallback = useRef({ fileName: entry.fileName, onUnavailable })
  fallback.current = { fileName: entry.fileName, onUnavailable }

  useEffect(() => {
    let cancelled = false
    setFile(null)
    fetch(`/api/documents/${encodeURIComponent(documentId)}/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`)
        const body = (await response.json()) as Partial<StatusBody>
        if (cancelled) return
        setFile(fileItemFromStatus({ ...body, id: documentId, filename: body.filename ?? fallback.current.fileName } as StatusBody))
      })
      .catch(() => !cancelled && fallback.current.onUnavailable())
    return () => {
      cancelled = true
    }
  }, [documentId])

  // Until the file is read, the place is held under a scrim, so a second press cannot open another file over it.
  if (!file) {
    return (
      <div className="bg-background/60 fixed inset-0 z-50 grid place-items-center" data-testid="standard-file-loading">
        <Spinner size="lg" />
      </div>
    )
  }
  return (
    <FilePreviewDialog
      file={file}
      onClose={onClose}
      scope="officeShelf"
      canManage={canManage}
      onDeleted={() => onChanged(null)}
      detailsLead={
        <StandardFacts entry={entry} canManage={canManage} onManage={onManage} onOpenEdition={onOpenEdition} onChanged={onChanged} />
      }
    />
  )
}
