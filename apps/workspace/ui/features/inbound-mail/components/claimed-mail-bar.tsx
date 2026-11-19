'use client'

import type { JSX } from 'react'
import { Lock } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { cn } from '@/lib/utils'
import { FactLine, PinnedBar } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface ClaimedMailBarProps {
  member: { name: string; address: string }
  confirmOpen: boolean
  onConfirmOpenChange: (open: boolean) => void
  onDismiss: () => void
  dismissing: boolean
  className?: string
}

export function ClaimedMailBar({
  member,
  confirmOpen,
  onConfirmOpenChange,
  onDismiss,
  dismissing,
  className,
}: ClaimedMailBarProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <PinnedBar data-testid="claimed-mail-bar" className={cn('sm:flex-row sm:items-center sm:justify-between', className)}>
      <FactLine icon={Lock} tone="default" testId="claimed-mail-line">
        {t('bar.claimed.line', { name: member.name })}
      </FactLine>
      <BusyButton
        type="button"
        variant="secondary"
        busy={dismissing}
        busyLabel={t('bar.dismissBusy')}
        onClick={() => onConfirmOpenChange(true)}
        className="w-full shrink-0 sm:w-auto"
        data-testid="decision-dismiss"
      >
        {t('bar.claimed.dismiss')}
      </BusyButton>
      <ClaimedDismissConfirm member={member} open={confirmOpen} onOpenChange={onConfirmOpenChange} onConfirm={onDismiss} />
    </PinnedBar>
  )
}

function ClaimedDismissConfirm({
  member,
  open,
  onOpenChange,
  onConfirm,
}: {
  member: ClaimedMailBarProps['member']
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('bar.claimed.confirmTitle')}
      description={t('bar.claimed.confirmText', { name: member.name, address: member.address, days: INBOUND_MAIL_RESTORE_DAYS })}
      confirmLabel={t('bar.claimed.confirm')}
      cancelLabel={t('bar.claimed.cancel')}
      onConfirm={() => {
        onOpenChange(false)
        onConfirm()
      }}
    />
  )
}
