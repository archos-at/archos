'use client'

import { useId, type JSX, type Ref } from 'react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { useTranslations } from '@/i18n'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { cn } from '@/lib/utils'
import type { DraftBlocker, DraftSummary } from '../lib/draft'
import { PinnedBar } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface DecisionBarProps {
  offersFiling: boolean
  questions: number
  impersonation?: boolean
  onOpenFiling: () => void
  onDismiss: () => void
  filing: boolean
  dismissing: boolean
  yieldPrimary?: boolean
  openRef?: Ref<HTMLButtonElement>
  className?: string
}

export function blockerText(blocker: DraftBlocker, t: Translate, summary?: Pick<DraftSummary, 'ownClaimedMail'>, impersonation = false): string | null {
  switch (blocker.kind) {
    case 'sender':
      return t(summary?.ownClaimedMail ? 'bar.blockers.senderOwn' : impersonation ? 'bar.blockers.senderImpersonation' : 'bar.blockers.sender')
    case 'project_closed':
    case 'thread_name_missing':
    case 'sender_only':
      return t(`bar.blockers.${blocker.kind}`)
    case 'folder_missing':
    case 'name_stop':
    case 'risk':
      return t(`bar.blockers.${blocker.kind}`, { count: blocker.count })
  }
}

export function DecisionBar({
  offersFiling,
  questions,
  impersonation = false,
  onOpenFiling,
  onDismiss,
  filing,
  dismissing,
  yieldPrimary = false,
  openRef,
  className,
}: DecisionBarProps): JSX.Element {
  const hintId = useId()
  const dismissId = useId()
  const t = useTranslations(inboundMailCopy)
  const dismissFirst = impersonation || !offersFiling
  const showsDismiss = dismissFirst || !yieldPrimary
  const dismissNote = t('bar.dismissNote', { days: INBOUND_MAIL_RESTORE_DAYS })
  const hint = questions > 0 ? t('filing.openHintQuestions', { count: questions }) : t('filing.openHint')

  return (
    <PinnedBar data-testid="decision-bar" className={className}>
      {/* On a desk what the presses do stands on the left, the presses on the right; on a phone the one note stands above them.
          DOM order is the reading order: „Verwerfen“, then the primary nearest the thumb. For an impersonation
          „Verwerfen“ IS the primary: it moves last, and „Einordnen …“ (once opened) is the quiet one. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          {offersFiling && !impersonation && (
            <p id={hintId} className="text-foreground text-xs max-sm:hidden" data-testid="decision-open-hint">
              {hint}
            </p>
          )}
          <p id={dismissId} className="text-muted-foreground text-xs" data-testid="decision-dismiss-note">
            {dismissNote}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 sm:gap-3">
          {/* While a batch bar is up its „Verwerfen“ is the one on screen: two raised „Verwerfen“ for two scopes was round 3. */}
          {showsDismiss && (
            <BusyButton
              type="button"
              size="sm"
              variant={dismissFirst && !yieldPrimary ? 'default' : 'secondary'}
              busy={dismissing}
              busyLabel={t('bar.dismissBusy')}
              onClick={onDismiss}
              blocked={filing}
              className={cn('min-w-0 flex-1 sm:flex-none', dismissFirst && 'order-last')}
              aria-describedby={dismissId}
              data-testid="decision-dismiss"
            >
              {t('bar.dismiss')}
            </BusyButton>
          )}
          {offersFiling && (
            <Button
              ref={openRef}
              type="button"
              size="sm"
              variant={dismissFirst || yieldPrimary ? 'secondary' : 'default'}
              onClick={onOpenFiling}
              disabled={filing || dismissing}
              aria-haspopup="dialog"
              aria-describedby={impersonation ? undefined : hintId}
              className={cn('min-w-0 sm:flex-none', showsDismiss ? 'flex-[2]' : 'flex-1')}
              data-testid="decision-open"
            >
              {t('filing.open')}
            </Button>
          )}
        </div>
      </div>
    </PinnedBar>
  )
}
