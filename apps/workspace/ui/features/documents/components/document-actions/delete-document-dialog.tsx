'use client'

import type { JSX } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentActions } from './use-document-actions'
import { DOCUMENT_SCOPE_COPY, type DocumentScope } from './document-scope'

export interface DeleteDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: DocumentScope
  actions: Pick<DocumentActions, 'name' | 'isDeleting' | 'erases' | 'remove'>
}

export function DeleteDocumentDialog({ open, onOpenChange, scope, actions }: DeleteDocumentDialogProps): JSX.Element {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[scope])
  const tFiles = useTranslations(filesCopy)
  const heldFile = actions.erases
  const busyLabel = heldFile ? tFiles('erase.deleting') : t('delete.deleting')
  const confirmLabel = heldFile ? tFiles('erase.confirmAction') : t('delete.confirmAction')
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={heldFile ? tFiles('erase.title', { name: actions.name }) : t('delete.title', { name: actions.name })}
      description={heldFile ? tFiles('erase.confirm') : t('delete.confirm')}
      confirmLabel={actions.isDeleting ? busyLabel : confirmLabel}
      cancelLabel={t('delete.cancel')}
      pending={actions.isDeleting}
      confirmTestId="document-delete-confirm"
      onConfirm={async () => {
        if (await actions.remove()) onOpenChange(false)
      }}
    />
  )
}
