'use client'

import type { JSX } from 'react'
import { UserRound, UserRoundX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { ProductFeedbackTicketView } from '@/lib/product-feedback/types'
import { cn } from '@/lib/utils'

export function CaseLine({
  ticket,
  canClaim,
  claiming,
  onClaim,
}: {
  ticket: ProductFeedbackTicketView
  canClaim: boolean
  claiming: boolean
  onClaim?: () => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const { locale } = useLocale()
  const { assignee } = ticket
  const holder = !assignee
    ? t('platform.case.unassigned')
    : assignee.isViewer
      ? t('platform.case.assignedToYou')
      : t('platform.case.assignedTo', {
          name: assignee.name ?? assignee.email ?? t('platform.case.unnamedAssignee'),
        })
  const HolderIcon = assignee ? UserRound : UserRoundX

  return (
    <div
      data-testid="feedback-case"
      className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
    >
      <span
        data-testid="feedback-assignee"
        className={cn('inline-flex min-w-0 items-center gap-1', !assignee && 'text-foreground')}
      >
        <HolderIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{holder}</span>
      </span>
      {ticket.awaiting ? (
        <Chip
          size="sm"
          variant={ticket.awaiting === 'team' ? 'warning' : 'muted'}
          data-testid="feedback-awaiting"
          data-awaiting={ticket.awaiting}
        >
          {t(`platform.case.awaiting.${ticket.awaiting}`)}
        </Chip>
      ) : null}
      <span className="inline-flex items-center gap-1">
        {t('platform.case.lastActivity')}
        <TimeAgo date={ticket.lastActivityAt} locale={locale} />
      </span>
      {canClaim && onClaim ? (
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          loading={claiming}
          onClick={onClaim}
          data-testid="feedback-claim"
        >
          {t('platform.case.claim')}
        </Button>
      ) : null}
    </div>
  )
}
