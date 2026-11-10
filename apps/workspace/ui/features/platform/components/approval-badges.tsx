'use client'

/**
 * How a platform change request was approved (ADR-0176): nothing for four eyes;
 * for one its author approved alone, that mark and where its second review
 * stands. Platform-internal: offices never see it.
 */

import type { JSX } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ChangeRequestSummary } from '@/lib/base-knowledge/platform/wire'

const TONE = { due: 'warning', confirmed: 'success', disputed: 'destructive' } as const

export function ApprovalBadges({
  approval,
  secondReview,
}: Pick<ChangeRequestSummary, 'approval' | 'secondReview'>): JSX.Element | null {
  const t = useTranslations(platformCopy)
  if (approval !== 'single') return null
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="approval-badges">
      <Badge variant="warning">{t('countryKnowledge.approval.single')}</Badge>
      {secondReview ? <Badge variant={TONE[secondReview.state]}>{t(`countryKnowledge.secondReview.${secondReview.state}`)}</Badge> : null}
    </div>
  )
}
