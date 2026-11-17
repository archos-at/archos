'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { CalendarClock, Pencil, Play, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SectionLabel } from '@/components/ui/section-label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { tasksCopy } from '@/i18n/namespaces/tasks'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { deleteJob, runJob, JobApiError, type Job } from '@/adapters/api/jobs-client'
import { capturePosthog } from '@/lib/analytics/posthog'
import { JobRunHistory } from './job-run-history'
import { ScheduleEnableSwitch } from './schedule-card'
import { nextOccurrences } from '../lib/occurrences'
import { whenSummary } from '../lib/schedule'

const PREVIEW_COUNT = 3

interface ScheduleDetailProps {
  projectId: string
  job: Job | null
  open: boolean
  canManage: boolean
  goneReason?: 'deleted' | 'unresolved'
  resolving?: boolean
  onChanged?: (job: Job) => void
  onDeleted?: (jobId: string) => void
  onEdit?: (job: Job) => void
  onClose: () => void
}

export function ScheduleDetail({
  projectId,
  job,
  open,
  canManage,
  goneReason = 'deleted',
  resolving = false,
  onChanged,
  onDeleted,
  onEdit,
  onClose,
}: ScheduleDetailProps): JSX.Element {
  const t = useTranslations(tasksCopy)
  const tj = useTranslations(jobsCopy)
  const tCommon = useTranslations(commonCopy)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('detail.close')}
        data-testid="schedule-detail"
        className="flex flex-col"
      >
        {job ? (
          <ScheduleDetailBody
            projectId={projectId}
            job={job}
            canManage={canManage}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onEdit={onEdit}
          />
        ) : (
          <div className="py-8">
            <SheetHeader>
              <SheetTitle>{resolving ? t('detail.loadingTitle') : t('detail.goneTitle')}</SheetTitle>
            </SheetHeader>
            {resolving ? (
              <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
                <Spinner size="sm" aria-hidden />
                {tCommon('states.loading')}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">
                {goneReason === 'unresolved' ? t('detail.goneUnresolved') : t('detail.gone')}
              </p>
            )}
          </div>
        )}
        <span className="sr-only">{tj('title')}</span>
      </SheetContent>
    </Sheet>
  )
}

function ScheduleDetailBody({
  projectId,
  job,
  canManage,
  onChanged,
  onDeleted,
  onEdit,
}: {
  projectId: string
  job: Job
  canManage: boolean
  onChanged: ((job: Job) => void) | undefined
  onDeleted: ((jobId: string) => void) | undefined
  onEdit: ((job: Job) => void) | undefined
}): JSX.Element {
  const t = useTranslations(tasksCopy)
  const tj = useTranslations(jobsCopy)
  const { locale } = useLocale()
  const [running, setRunning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [historyToken, setHistoryToken] = useState(0)
  const upcoming = useUpcoming(job)

  const runNow = async () => {
    setRunning(true)
    try {
      const result = await runJob(projectId, job.id)
      if (result.status === 'skipped') {
        toast.warning(tj('run.skipped'), { description: result.error ?? undefined })
      } else if (result.status === 'error' || result.status === 'failed') {
        toast.error(tj('run.error'), { description: result.error ?? undefined })
      } else {
        capturePosthog('job_run_submitted', { output: job.output })
        toast.success(tj('run.submitted'), { description: tj('run.submittedDetail') })
        setHistoryToken((token) => token + 1)
        onChanged?.({ ...job, lastRunAt: new Date().toISOString() })
      }
    } catch (err) {
      if (err instanceof JobApiError && err.status === 409) {
        onChanged?.({ ...job, enabled: false })
        toast.error(tj('run.disabled'))
      } else {
        toast.error(tj('run.error'))
      }
    } finally {
      setRunning(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await deleteJob(projectId, job.id)
      capturePosthog('job_deleted', { output: job.output })
      setConfirmOpen(false)
      onDeleted?.(job.id)
    } catch {
      toast.error(tj('deleteDialog.error'))
    } finally {
      setDeleting(false)
    }
  }

  const lastRun = job.lastRunAt
    ? tj('list.lastRun', { time: formatRelativeTime(job.lastRunAt, locale) })
    : tj('list.neverRun')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2 pr-1">
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="secondary">
            {tj(`list.output.${job.output}`)}
          </Chip>
          {!job.enabled && (
            <Chip size="sm" variant="outline">
              {tj('list.disabled')}
            </Chip>
          )}
        </div>
        <SheetTitle className="mt-2 text-left">{job.name}</SheetTitle>
        <SheetDescription className="text-left" data-testid="schedule-detail-cadence">
          {whenSummary(tj, job, locale)}
        </SheetDescription>
      </SheetHeader>

      <section aria-label={t('detail.schedule')}>
        <div className="flex items-center justify-between gap-3">
          <SectionLabel as="h2">{t('detail.schedule')}</SectionLabel>
          {canManage && <ScheduleEnableSwitch job={job} onChanged={onChanged} t={tj} />}
        </div>

        {/* The claim, made checkable. See the module docstring. */}
        <div className="bg-muted mt-2 rounded-lg p-3" data-testid="schedule-detail-upcoming">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {tj('builder.upcomingLabel')}
          </p>
          {upcoming === null ? (
            <p className="text-muted-foreground mt-1.5 flex items-center gap-2 text-sm">
              <Spinner size="sm" aria-hidden />
            </p>
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground mt-1.5 text-sm">{tj('builder.upcomingNone')}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {upcoming.map((at) => (
                <li key={at.toISOString()} className="text-foreground text-sm tabular-nums">
                  {formatAbsoluteTime(at.toISOString(), locale)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-muted-foreground mt-2 text-xs">{lastRun}</p>
        <p className="text-muted-foreground mt-1.5 flex min-w-0 items-center gap-1.5 text-xs">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {job.skillName ? tj('list.withSkill', { name: job.skillName }) : tj('list.noSkill')}
          </span>
        </p>

        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void runNow()} disabled={running || !job.enabled} aria-busy={running}>
              {running ? <Spinner size="sm" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              {tj('actions.runNow')}
            </Button>
            {onEdit && (
              <Button size="sm" variant="secondary" onClick={() => onEdit(job)} data-testid="schedule-detail-edit">
                <Pencil className="size-3.5" aria-hidden />
                {t('detail.edit')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive ml-auto"
              onClick={() => setConfirmOpen(true)}
              data-testid="schedule-detail-delete"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {tj('actions.delete')}
            </Button>
          </div>
        )}
      </section>

      <section aria-label={t('detail.prompt')}>
        <SectionLabel as="h2">{t('detail.prompt')}</SectionLabel>
        <p
          className="bg-muted mt-2 whitespace-pre-wrap rounded-lg p-3 font-mono text-xs leading-relaxed"
          data-testid="schedule-detail-prompt"
        >
          {job.prompt}
        </p>
      </section>

      <section aria-label={t('detail.runs')}>
        <SectionLabel as="h2">{t('detail.runs')}</SectionLabel>
        <div className="mt-2" data-testid="schedule-detail-runs">
          <JobRunHistory
            key={historyToken}
            projectId={projectId}
            jobId={job.id}
          />
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title={tj('deleteDialog.title')}
        description={tj('deleteDialog.description', { name: job.name })}
        confirmLabel={tj('deleteDialog.confirm')}
        cancelLabel={tj('deleteDialog.cancel')}
        pending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function useUpcoming(job: Job): Date[] | null {
  const [upcoming, setUpcoming] = useState<Date[] | null>(null)
  const cron = job.scheduleCron
  const timezone = job.scheduleTimezone
  const enabled = job.enabled

  useEffect(() => {
    if (!cron || !enabled) {
      setUpcoming([])
      return
    }
    let cancelled = false
    setUpcoming(null)
    void nextOccurrences(cron, timezone, PREVIEW_COUNT).then((dates) => {
      if (!cancelled) setUpcoming(dates)
    })
    return () => {
      cancelled = true
    }
  }, [cron, timezone, enabled])

  return upcoming
}
