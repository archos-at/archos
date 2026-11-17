'use client'

import { type FC } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'

export interface DeleteFileConfirmationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  fileName?: string
}

export const DeleteFileConfirmationModal: FC<DeleteFileConfirmationModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
  fileName,
}) => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)
  const trimmedName = fileName?.trim()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('deleteModals.file.title')}
      description={
        <>
          {t('deleteModals.aboutToDelete')}{' '}
          {trimmedName ? (
            <span className="font-medium text-foreground">&ldquo;{trimmedName}&rdquo;</span>
          ) : (
            t('deleteModals.file.thisFile')
          )}
          {t('deleteModals.file.suffix')}
        </>
      }
      confirmLabel={t('deleteModals.file.confirm')}
      cancelLabel={tc('actions.cancel')}
      onConfirm={onConfirm}
    >
      <p className="text-sm">{t('deleteModals.cannotReverse')}</p>
    </ConfirmDialog>
  )
}
