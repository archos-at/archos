'use client'

import { type FC } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'

export interface DeleteAllSessionsConfirmationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
  side: 'personal' | 'project'
}

export const DeleteAllSessionsConfirmationModal: FC<DeleteAllSessionsConfirmationModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
  side,
}) => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={side === 'personal' ? t('deleteModals.all.titlePersonal') : t('deleteModals.all.titleProject')}
      description={
        <>
          {t('deleteModals.aboutToDelete')}{' '}
          <span className="font-medium text-foreground">
            {side === 'personal' ? t('deleteModals.all.whatPersonal') : t('deleteModals.all.whatProject')}
          </span>
          {t('deleteModals.lossSuffix')}
        </>
      }
      confirmLabel={t('deleteModals.all.confirm')}
      cancelLabel={tc('actions.cancel')}
      onConfirm={onConfirm}
    >
      <p className="text-sm">
        {side === 'personal' ? t('deleteModals.all.scopeNotePersonal') : t('deleteModals.all.scopeNoteProject')}
      </p>
      <p className="text-sm">{t('deleteModals.cannotReverse')}</p>
    </ConfirmDialog>
  )
}
