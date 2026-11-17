'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarPlus, FileText, MessageSquare, MessagesSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/section-label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { tasksCopy } from '@/i18n/namespaces/tasks'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import type { ScheduleDraft } from '@/features/jobs/lib/schedule-draft'
import { RunBlock } from '@/features/runs/components/RunBlock'
import { useTaskRun } from '../hooks/use-task-run'
import { isActiveTask, taskResultTarget, taskThreadHref, type TaskRunView } from '../lib/task-view'

const RESULT_ICON: Record<'document' | 'conversation', LucideIcon> = {
  document: FileText,
  conversation: MessageSquare,
}

interface TaskDetailProps {
  projectId: string
  task: TaskRunView | null
  open: boolean
  goneReason?: 'deleted' | 'unresolved'
  resolving?: boolean
  canManageJobs: boolean
  onPromoteToTask?: (draft: ScheduleDraft) => void
  onClose: () => void
}

export function TaskDetail({
  projectId,
  task,
  open,
  goneReason = 'deleted',
  resolving = false,
  canManageJobs,
  onPromoteToTask,
  onClose,
}: TaskDetailProps): JSX.Element {
  const t = useTranslations(tasksCopy)
  const tCommon = useTranslations(commonCopy)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('detail.close')}
        data-testid="task-detail"
        className="flex flex-col overflow-y-hidden pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        {task ? (
          <TaskDetailBody
            projectId={projectId}
            task={task}
            canManageJobs={canManageJobs}
            onPromoteToTask={onPromoteToTask}
          />
        ) : (
          <div className="py-8">
            <SheetHeader>
              {/* While the deep link is still being checked, the heading says
                  so: „Nicht gefunden" over a pending read is a finding before
                  there is anything to find. */}
              <SheetTitle>
                {resolving ? t('detail.loadingTitle') : t('detail.goneTitle')}
              </SheetTitle>
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
      </SheetContent>
    </Sheet>
  )
}

function TaskDetailBody({
  projectId,
  task,
  canManageJobs,
  onPromoteToTask,
}: {
  projectId: string
  task: TaskRunView
  canManageJobs: boolean
  onPromoteToTask: ((draft: ScheduleDraft) => void) | undefined
}): JSX.Element {
  const t = useTranslations(tasksCopy)
  const { locale } = useLocale()
  const result = taskResultTarget(projectId, task)
  const ResultIcon = result ? RESULT_ICON[result.kind] : null
  const threadHref = taskThreadHref(projectId, task)
  const promotable =
    canManageJobs && onPromoteToTask && task.trigger !== 'schedule' && Boolean(task.goal)
  const revision = isActiveTask(task)
    ? `${task.status}:${task.runSummary?.status ?? ''}:${task.runSummary?.rounds ?? 0}`
    : 'settled'
  const { ledger, loading, failed } = useTaskRun({
    projectId,
    runId: task.runMessageId ? task.id : null,
    revision,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The reader opened the drawer for the RESULT, and the run block above
          it is three rounds of sources, a thousand pixels on a phone. The body
          scrolls; the way to the result does not. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2 pr-1"
        data-testid="task-detail-body"
      >
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="outline">
              {t(`kind.${task.kind}`)}
            </Chip>
            <Chip size="sm" variant="secondary">
              {t('cadence.once')}
            </Chip>
          </div>
          {/* The title is here AND inside the block, which is not a repetition
            worth removing: the sheet needs an accessible name, and the block's
            own header is the block's header. Visually hidden for that reason —
            the block states it where the reader is looking. */}
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
        </SheetHeader>

        {/* The account of the work. `defaultOpen` because the drawer IS the act
          of asking for it: a reader who clicked the row has already said they
          want more than the line the card gave them. */}
        {ledger ? (
          <RunBlock
            ledger={ledger}
            title={task.title}
            projectId={null}
            className="shrink-0"
            defaultOpen
            review={task.review ? { decision: task.review, reason: task.reviewReason } : null}
          />
        ) : loading ? (
          <p
            className="text-muted-foreground flex items-center gap-2 text-sm"
            data-testid="task-detail-run-loading"
          >
            <Spinner size="sm" aria-hidden />
            {t('detail.runLoading')}
          </p>
        ) : (
          <TaskDetailFallback task={task} failed={failed} />
        )}

        {promotable && (
          <section aria-label={t('detail.promote')}>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => onPromoteToTask?.({ name: task.title, prompt: task.goal ?? '' })}
              data-testid="task-detail-promote"
            >
              <CalendarPlus aria-hidden />
              {t('detail.promote')}
            </Button>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {t('detail.promoteHint')}
            </p>
          </section>
        )}

        <p
          className="card-caption text-muted-foreground mt-auto"
          title={formatAbsoluteTime(task.createdAt, locale)}
        >
          {task.requesterName
            ? t('meta.byOn', {
                name: task.requesterName,
                when: formatRelativeTime(task.createdAt, locale),
              })
            : t('meta.on', { when: formatRelativeTime(task.createdAt, locale) })}
        </p>
      </div>

      {(result || threadHref) && (
        <section
          aria-label={t('detail.result')}
          data-testid="task-detail-actions"
          className="border-border flex flex-col items-stretch gap-2 border-t pt-3"
        >
          {result && ResultIcon && (
            <Button asChild data-testid="task-detail-result">
              <Link href={result.href}>
                <ResultIcon aria-hidden />
                {t(`result.${result.kind}`)}
                <ArrowRight aria-hidden className="ml-auto size-4" />
              </Link>
            </Button>
          )}
          {/* Never folded into the result button. The thread is where a live
              run is watched and where a run that asked a question is
              answered — the drawer reads, it does not follow. Offered even
              when the result IS the conversation: then the two links point
              at the same place and the second one is dropped. */}
          {threadHref && result?.kind !== 'conversation' && (
            <Button variant="secondary" asChild data-testid="task-detail-thread">
              <Link href={threadHref}>
                <MessagesSquare aria-hidden />
                {t('detail.openThread')}
                <ArrowRight aria-hidden className="ml-auto size-4" />
              </Link>
            </Button>
          )}
        </section>
      )}
    </div>
  )
}

function TaskDetailFallback({ task, failed }: { task: TaskRunView; failed: boolean }): JSX.Element {
  const t = useTranslations(tasksCopy)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm" data-testid="task-detail-status">
        {t(`status.${task.status}`)}
        {task.review ? ` · ${t(`review.${task.review}`)}` : ''}
      </p>

      {failed && (
        <p
          className="text-muted-foreground text-sm leading-relaxed"
          data-testid="task-detail-run-failed"
        >
          {t('detail.runUnavailable')}
        </p>
      )}

      {task.goal && (
        <section aria-label={t('detail.request')}>
          <SectionLabel as="h2">{t('detail.request')}</SectionLabel>
          <p className="mt-2 text-sm leading-relaxed" data-testid="task-detail-goal">
            {task.goal}
          </p>
        </section>
      )}

      {task.review === 'rejected' && task.reviewReason && (
        <p
          className="text-muted-foreground text-sm leading-relaxed"
          data-testid="task-detail-review-reason"
        >
          {task.reviewReason}
        </p>
      )}

      {(task.status === 'failed' || task.status === 'error') && task.error && (
        <p className="text-error text-sm leading-relaxed" data-testid="task-detail-error">
          {task.error}
        </p>
      )}
    </div>
  )
}
