'use client'

import { type FC } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'

export interface DeleteAllSessionsConfirmationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  count?: number
}

export const DeleteAllSessionsConfirmationModal: FC<DeleteAllSessionsConfirmationModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
  count,
}) => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('deleteModals.all.title')}
      description={
        <>
          {t('deleteModals.aboutToDelete')}{' '}
          <span className="font-medium text-foreground">
            {count && count > 0
              ? t('deleteModals.all.countSessions', { count })
              : t('deleteModals.all.allSessions')}
          </span>
          {t('deleteModals.lossSuffix')}
        </>
      }
      confirmLabel={t('deleteModals.all.confirm')}
      cancelLabel={tc('actions.cancel')}
      onConfirm={onConfirm}
    >
      {/* Scope reassurance: delete-all is project-local (UX-8). */}
      <p className="text-sm">{t('deleteModals.all.scopeNote')}</p>
      <p className="text-sm">{t('deleteModals.cannotReverse')}</p>
    </ConfirmDialog>
  )
}
