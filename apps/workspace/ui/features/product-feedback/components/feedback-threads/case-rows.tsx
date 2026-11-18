'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { CountPill } from '@/components/ui/count-pill'
import { Item, ItemActions, ItemContent, ItemDescription, ItemList, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { OwnProductFeedbackSummary } from '@/lib/product-feedback/types'
import { FeedbackCaseStatus, feedbackCaseState } from '../feedback-atoms'
import { FEEDBACK_KIND_ICONS } from '../feedback-form'
import type { FeedbackScope } from '../../lib/feedback-threads-api'

export function CaseGroup({
  label,
  reports,
  scope,
  selectedId,
  onSelect,
  testId,
}: {
  label: string
  reports: OwnProductFeedbackSummary[]
  scope: FeedbackScope
  selectedId: string | null
  onSelect: (id: string) => void
  testId: string
}): JSX.Element {
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid={`feedback-group-${testId}`}>
      <div className="flex items-center gap-2 px-1">
        <SectionLabel as="h3" id={headingId}>
          {label}
        </SectionLabel>
        <CountPill count={reports.length} />
      </div>
      <ItemList as="ul">
        {reports.map((report) => (
          <CaseRow
            key={report.id}
            report={report}
            scope={scope}
            selected={report.id === selectedId}
            onSelect={() => onSelect(report.id)}
          />
        ))}
      </ItemList>
    </section>
  )
}

function CaseRow({
  report,
  scope,
  selected,
  onSelect,
}: {
  report: OwnProductFeedbackSummary
  scope: FeedbackScope
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const { locale } = useLocale()
  const Icon = FEEDBACK_KIND_ICONS[report.kind]
  return (
    <li>
      <Item asChild>
        <button
          type="button"
          onClick={onSelect}
          className="w-full"
          aria-current={selected || undefined}
          data-testid={`feedback-thread-${report.id}`}
        >
          <ItemMedia>
            <Icon className="text-muted-foreground size-4" aria-hidden />
          </ItemMedia>
          <ItemContent className="gap-1.5">
            {/* `truncate` is the atom's default; two lines of the report is what
                tells one bug from the next, so it wraps and clamps instead. */}
            <ItemTitle className="line-clamp-2 font-normal whitespace-normal">{report.excerpt}</ItemTitle>
            <ItemDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <FeedbackCaseStatus state={feedbackCaseState(report.status)} mine={report.mine} />
              {scope === 'office' && <span className="text-foreground">{report.reporterName ?? t('threads.unknownReporter')}</span>}
              <span>{t(`kinds.${report.kind}.label`)}</span>
              {report.ticketNumber !== null && (
                <span className="tabular-nums">{t('threads.ticketNumber', { number: report.ticketNumber })}</span>
              )}
              <span>
                {t('threads.updated')} <TimeAgo date={report.lastActivityAt} locale={locale} />
              </span>
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {report.hasUpdate && <CountPill tone="attention">{t('threads.hasUpdate')}</CountPill>}
            <ChevronRight className="text-muted-foreground size-4 md:hidden" aria-hidden />
          </ItemActions>
        </button>
      </Item>
    </li>
  )
}
