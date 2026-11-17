'use client'

import type { JSX } from 'react'

import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { SupportTicketStatus } from '@/lib/product-feedback/types'

export type FeedbackCaseState = 'awaiting' | 'done' | 'unknown' | Exclude<SupportTicketStatus, 'pending' | 'resolved'>

export function feedbackCaseState(status: SupportTicketStatus | null, teamSpokeLast = false): FeedbackCaseState {
  if (status === 'resolved') return 'done'
  if (status === 'pending' || teamSpokeLast) return 'awaiting'
  return status ?? 'unknown'
}

export function FeedbackCaseStatus({
  state,
  mine,
}: {
  state: FeedbackCaseState
  mine: boolean
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const label =
    state === 'awaiting'
      ? mine
        ? t('threads.statuses.pending')
        : t('threads.officeStatuses.pending')
      : state === 'done'
        ? t('threads.statuses.resolved')
        : t(`threads.statuses.${state}`)
  const variant = state === 'awaiting' && mine ? 'default' : state === 'done' ? 'secondary' : 'outline'
  return (
    <Badge variant={variant} className="rounded-full px-2 py-0 leading-5" data-testid="feedback-case-status" data-state={state}>
      {label}
    </Badge>
  )
}
