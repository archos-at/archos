'use client'

import { type FC } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'

export interface DeleteSessionConfirmationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  sessionTitle?: string
}

export const DeleteSessionConfirmationModal: FC<DeleteSessionConfirmationModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
  sessionTitle,
}) => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)
  const trimmedTitle = sessionTitle?.trim()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('deleteModals.session.title')}
      description={
        <>
          {t('deleteModals.aboutToDelete')}{' '}
          {trimmedTitle ? (
            <span className="font-medium text-foreground">&ldquo;{trimmedTitle}&rdquo;</span>
          ) : (
            t('deleteModals.session.thisSession')
          )}
          {t('deleteModals.lossSuffix')}
        </>
      }
      confirmLabel={t('deleteModals.session.confirm')}
      cancelLabel={tc('actions.cancel')}
      onConfirm={onConfirm}
    >
      <p className="text-sm">{t('deleteModals.cannotReverse')}</p>
    </ConfirmDialog>
  )
}
