'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { MarkTally } from '@/lib/annotations/types'
import type { DocumentScope } from './document-actions'
import type { FileItem } from './project-file-workspace'
import { FilePreviewPane } from './file-preview-pane'

interface FilePreviewDialogProps {
  file: FileItem | null
  onClose: () => void
  projectId?: string
  projectName?: string
  canManage?: boolean
  scope?: DocumentScope
  onReingested?: (fileId: string, status: string) => void
  onTagsUpdated?: (fileId: string, tags: string[], topics?: string[]) => void
  onOpenDocument?: (fileId: string) => void
  onRevisionChanged?: (fileId: string, revision: RevisionLinks | null) => void
  onMarksChanged?: (fileId: string, marks: MarkTally | null) => void
  onRenamed?: (fileId: string, displayName: string | null) => void
  onDeleted?: (fileId: string) => void
  showModels?: boolean
  canCollaborate?: boolean
  detailsLead?: ReactNode
}

export function FilePreviewDialog({
  file,
  onClose,
  projectId,
  projectName,
  canManage,
  scope = 'files',
  onReingested,
  onTagsUpdated,
  onOpenDocument,
  onRevisionChanged,
  onMarksChanged,
  onRenamed,
  onDeleted,
  showModels,
  canCollaborate,
  detailsLead,
}: FilePreviewDialogProps) {
  const t = useTranslations(filesCopy)

  const openerRef = useRef<HTMLElement | null>(null)
  const isOpen = file !== null

  useEffect(() => {
    if (isOpen) {
      const active = document.activeElement
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    }
  }, [isOpen])

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      {file && (
        <DialogContent
          className="flex h-dvh max-h-dvh w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[85dvh] sm:max-h-[85dvh] sm:max-w-[960px] sm:rounded-overlay phone:inset-0 phone:h-dvh phone:max-h-dvh phone:max-w-none phone:translate-x-0 phone:translate-y-0 phone:rounded-none phone:border-0"
          mobilePresentation="none"
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement | null)?.focus()
          }}
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current
            if (!opener?.isConnected) return
            event.preventDefault()
            opener.focus()
          }}
        >
          {/* Radix requires a title for the accessible name. The pane renders
              the filename visually, so this one is screen-reader only. */}
          <DialogTitle className="sr-only">
            {t('preview.dialogLabel', { name: documentDisplayName(file) })}
          </DialogTitle>

          <FilePreviewPane
            file={file}
            projectId={projectId}
            projectName={projectName}
            canManage={canManage}
            scope={scope}
            onClose={onClose}
            onReingested={onReingested}
            onTagsUpdated={onTagsUpdated}
            onOpenDocument={onOpenDocument}
            onRevisionChanged={onRevisionChanged}
            onMarksChanged={onMarksChanged}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
            showModels={showModels}
            canCollaborate={canCollaborate}
            detailsLead={detailsLead}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}
