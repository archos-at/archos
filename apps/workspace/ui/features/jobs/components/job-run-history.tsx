'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarClock, Hand, MessageSquare } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemActions, ItemContent, ItemList } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { tasksCopy } from '@/i18n/namespaces/tasks'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { isActiveTaskRunStatus, type TaskRunStatus } from '@/lib/tasks/task-vocabulary'
import { listJobRuns, type JobRun } from '@/adapters/api/jobs-client'
import { taskThreadHref } from '@/features/tasks/lib/task-view'

interface JobRunHistoryProps {
  projectId: string
  jobId: string
}

const STATUS_VARIANT: Record<TaskRunStatus, NonNullable<BadgeProps['variant']>> = {
  queued: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'destructive',
  interrupted: 'secondary',
  skipped: 'warning',
  error: 'destructive',
}

const TRIGGER_ICON = { schedule: CalendarClock, manual: Hand, delegated: MessageSquare } as const

const ACTIVE_POLL_MS = 10000

const ABSOLUTE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export function runTimeLabel(iso: string, locale: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime()
  if (Number.isNaN(at) || now - at <= ABSOLUTE_AFTER_MS) return formatRelativeTime(iso, locale, now)
  return formatAbsoluteTime(iso, locale)
}

export function JobRunHistory({ projectId, jobId }: JobRunHistoryProps): JSX.Element {
  const t = useTranslations(jobsCopy)
  const tTasks = useTranslations(tasksCopy)
  const { locale } = useLocale()
  const [runs, setRuns] = useState<JobRun[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setRuns(null)
    setError(false)
    listJobRuns(projectId, jobId, { limit: 20 })
      .then(setRuns)
      .catch(() => setError(true))
  }, [projectId, jobId])

  useEffect(() => {
    load()
  }, [load])

  const anyActive = runs?.some((run) => isActiveTaskRunStatus(run.status)) ?? false
  useEffect(() => {
    if (!anyActive) return
    const timer = setTimeout(() => {
      listJobRuns(projectId, jobId, { limit: 20 })
        .then(setRuns)
        .catch(() => undefined)
    }, ACTIVE_POLL_MS)
    return () => clearTimeout(timer)
  }, [anyActive, runs, projectId, jobId])

  if (error) {
    return (
      <LoadError className="mt-1" title={t('history.loadError')} onRetry={load} />
    )
  }

  if (runs === null) {
    return (
      <div className="space-y-2 py-2" data-testid="job-run-history-loading">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (runs.length === 0) {
    return <EmptyState variant="bare" title={t('history.empty')} />
  }

  return (
    <ItemList as="ul" className="animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none">
      {runs.map((run) => {
        const TriggerIcon = TRIGGER_ICON[run.trigger]
        const link = taskThreadHref(projectId, run)
        const linkLabel = isActiveTaskRunStatus(run.status) ? t('history.viewProgress') : t('history.openChat')

        return (
          <Item as="li" key={run.id} className="flex-wrap justify-between py-2.5 max-sm:gap-y-0">
            {/* Two lines on a phone: what happened (badges, when, and the reason
                a run was skipped), then where to go. The row used to let the
                badges and the link share one non-wrapping line, and the link
                painted over the status. */}
            <ItemContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 max-sm:basis-full">
              <Badge variant="secondary" className="shrink-0 gap-1">
                <TriggerIcon className="size-3" aria-hidden />
                {t(`history.trigger.${run.trigger}`)}
              </Badge>
              <Badge variant={STATUS_VARIANT[run.status]} className="shrink-0" data-testid="run-status">
                {tTasks(`status.${run.status}`)}
              </Badge>
              <time
                dateTime={run.createdAt}
                className="text-xs text-muted-foreground whitespace-nowrap"
                title={formatAbsoluteTime(run.createdAt, locale)}
              >
                {runTimeLabel(run.createdAt, locale)}
              </time>
              {/* The reason is the part a person acts on, and a `title` does not
                  exist on a touch screen. */}
              {run.error && (
                <p className="text-muted-foreground basis-full text-xs" data-testid="run-detail">
                  {run.error}
                </p>
              )}
            </ItemContent>
            {link && (
              <ItemActions className="max-sm:w-full max-sm:justify-end">
                <Button asChild size="sm" variant="ghost" className="shrink-0 max-sm:-mr-2">
                  <Link href={link}>
                    {linkLabel}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              </ItemActions>
            )}
          </Item>
        )
      })}
    </ItemList>
  )
}
