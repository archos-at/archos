'use client'

/**
 * The decision bar for a mail only another member may file
 * (`onlySenderReleases`, ADR-0137's amendment of 2026-11-03): it carries a
 * colleague's address, and that colleague's domain did not confirm it. The
 * reader may dismiss it and nothing else (`sender_only` refuses a filing and a
 * restore alike), so the bar holds one line naming whom it waits for and
 * „Verwerfen …“, behind a confirmation that says the reader cannot take it
 * back: once dismissed, only that member restores it.
 *
 * No primary „Ablegen“, no „Nichts ablegen“: the full filing bar gave a
 * colleague every control to try, and its ink button discarded the mail.
 * Under an impersonation warning „Verwerfen …“ is the primary press; else a
 * quiet one, since waiting for the member is the normal course.
 */

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
  /** The member the mail claims: the display name it carries, and the address that makes it theirs. */
  member: { name: string; address: string }
  /** The mail reads as an impersonation: dismissing it is the one press the page asks for. */
  impersonation: boolean
  /** Ask for the confirmation (the keyboard's ⌫ opens it too). */
  confirmOpen: boolean
  onConfirmOpenChange: (open: boolean) => void
  onDismiss: () => void
  dismissing: boolean
  className?: string
}

export function ClaimedMailBar({
  member,
  impersonation,
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
        variant={impersonation ? 'default' : 'secondary'}
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
