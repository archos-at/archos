'use client'

import type { JSX } from 'react'

import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { MIN_RATE_VOTES } from '../answer-feedback-types'
import { FeedbackDigest } from '../feedback-digest'
import { FeedbackTrend, FeedbackTrendDirection } from '../feedback-trend'
import { SectionCard } from '../section-card'
import { OrganizationsCard, ReasonsCard, TopicsCard } from './breakdown-cards'
import { BUSY_CLASS } from './busy-class'
import type { HealthContentProps } from './health-content-props'
import { KpiRow } from './kpi-row'
import { TurnsCard } from './turns-card'

export function HealthContent(props: HealthContentProps): JSX.Element {
  const { data, busy, digestSearch, locale } = props
  const t = useTranslations(platformCopy)
  const dim = cn(BUSY_CLASS, busy && 'opacity-60')

  return (
    <div className="flex flex-col gap-6" aria-busy={busy || undefined}>
      {busy ? (
        <span className="sr-only" role="status">
          {t('answerFeedback.updating')}
        </span>
      ) : null}
      <KpiRow data={data} narrowed={props.narrowed} locale={locale} className={dim} />

      <FeedbackDigest search={digestSearch} />

      <SectionCard
        title={t('answerFeedback.trendHeading')}
        description={t('answerFeedback.trendAria')}
        action={
          <FeedbackTrendDirection
            points={data.daily}
            windowDays={data.windowDays}
            endDay={data.to}
            minVotes={MIN_RATE_VOTES}
          />
        }
        testId="feedback-trend-card"
      >
        <div className={dim}>
          <FeedbackTrend
            points={data.daily}
            windowDays={data.windowDays}
            endDay={data.to}
            minVotes={MIN_RATE_VOTES}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 md:grid-cols-2">
        <ReasonsCard {...props} className={dim} />
        <TopicsCard {...props} className={dim} />
      </div>

      <OrganizationsCard {...props} className={dim} />

      <TurnsCard {...props} />
    </div>
  )
}
