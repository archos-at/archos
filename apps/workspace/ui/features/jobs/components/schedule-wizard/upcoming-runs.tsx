'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { formatAbsoluteTime } from '@/lib/format'

import { nextOccurrences } from '../../lib/occurrences'

const PREVIEW_COUNT = 3

export function UpcomingRuns({
  cron,
  dueAt = null,
  timezone,
  locale,
}: {
  cron: string | null
  dueAt?: Date | null
  timezone: string
  locale: string
}): JSX.Element {
  const t = useTranslations(jobsCopy)
  const [upcoming, setUpcoming] = useState<Date[] | null>(null)

  useEffect(() => {
    if (dueAt) {
      setUpcoming([dueAt])
      return
    }
    if (!cron) {
      setUpcoming([])
      return
    }
    let cancelled = false
    setUpcoming(null)
    const timer = setTimeout(() => {
      void nextOccurrences(cron, timezone, PREVIEW_COUNT).then((dates) => {
        if (!cancelled) setUpcoming(dates)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cron, dueAt, timezone])

  return (
    <div className="bg-muted rounded-lg p-3" data-testid="wizard-upcoming">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        {t('builder.upcomingLabel')}
      </p>
      {upcoming === null ? (
        <p className="text-muted-foreground mt-1.5 flex h-16 items-center gap-2 text-sm">
          <Spinner size="sm" aria-hidden />
        </p>
      ) : upcoming.length === 0 ? (
        <p className="text-muted-foreground mt-1.5 flex h-16 items-center text-sm">
          {t('builder.upcomingNone')}
        </p>
      ) : (
        <ul className="mt-1.5 flex h-16 flex-col justify-center gap-0.5">
          {upcoming.map((at) => (
            <li key={at.toISOString()} className="text-foreground text-sm tabular-nums">
              {formatAbsoluteTime(at.toISOString(), locale)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
