'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import type { BaseKnowledgeEntry } from '@/adapters/api/base-knowledge-client'
import { FilePreviewDialog, fileItemFromStatus, type FileItem } from '@/features/documents/file-preview'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { StandardFacts } from './standard-facts'

interface StandardFileProps {
  entry: BaseKnowledgeEntry
  canManage: boolean
  onClose: () => void
  onManage: () => void
  onOpenEdition: (entryId: string) => void
  onChanged: (entry: BaseKnowledgeEntry | null) => void
  onUnavailable: () => void
}

type StatusBody = Parameters<typeof fileItemFromStatus>[0]

export function StandardFile({ entry, canManage, onClose, onManage, onOpenEdition, onChanged, onUnavailable }: StandardFileProps): JSX.Element {
  const [file, setFile] = useState<FileItem | null>(null)
  const documentId = entry.documentId
  const fallback = useRef({ fileName: entry.fileName, entryId: entry.id, onUnavailable })
  fallback.current = { fileName: entry.fileName, entryId: entry.id, onUnavailable }

  useEffect(() => {
    let cancelled = false
    setFile(null)
    fetch(`/api/documents/${encodeURIComponent(documentId)}/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`)
        const body = (await response.json()) as Partial<StatusBody>
        if (cancelled) return
        setFile({
          ...fileItemFromStatus({ ...body, id: documentId, filename: body.filename ?? fallback.current.fileName } as StatusBody),
          baseKnowledgeEntryId: fallback.current.entryId,
        })
      })
      .catch(() => !cancelled && fallback.current.onUnavailable())
    return () => {
      cancelled = true
    }
  }, [documentId])

  if (!file) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton={false} mobilePresentation="none" className="w-auto p-6" aria-describedby={undefined} data-testid="standard-file-loading">
          <DialogTitle className="sr-only">{entry.fileName}</DialogTitle>
          <Spinner size="lg" />
        </DialogContent>
      </Dialog>
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
