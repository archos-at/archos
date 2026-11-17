'use client'

import { type FC } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'

export interface StopResearchConfirmationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const StopResearchConfirmationModal: FC<StopResearchConfirmationModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('sessionsPanel.stopConfirmTitle')}
      description={t('sessionsPanel.stopConfirmBody')}
      confirmLabel={t('sessionsPanel.stopConfirmConfirm')}
      cancelLabel={tc('actions.cancel')}
      confirmTestId="stop-research-confirm"
      onConfirm={onConfirm}
    />
  )
}
