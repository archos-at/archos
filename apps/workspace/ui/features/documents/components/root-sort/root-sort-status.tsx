'use client'

import type { JSX } from 'react'
import { ArrowRight, CheckCircle2, FileText } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { StageTrack, type StageTrackTone } from '@/components/ui/stage-track'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatCount, formatDurationElapsed, formatDurationShort } from '@/lib/format'
import type { RootSortRunStatus } from '@/lib/filing/root-sort-types'
import type { WorkingRootSortStatus } from '../../lib/root-sort-phase'

const STAGES = ['judge', 'group', 'review', 'move'] as const

function stagePosition(status: RootSortRunStatus | null): { reached: number; active: boolean; tone: StageTrackTone } | null {
  switch (status) {
    case null:
      return { reached: 0, active: false, tone: 'moving' }
    case 'judging':
      return { reached: 0, active: true, tone: 'moving' }
    case 'grouping':
      return { reached: 1, active: true, tone: 'moving' }
    case 'ready':
      return { reached: 2, active: true, tone: 'moving' }
    case 'applying':
      return { reached: 3, active: true, tone: 'moving' }
    case 'applied':
      return { reached: 4, active: false, tone: 'settled' }
    default:
      return null
  }
}

export interface RootSortStagesProps {
  status: RootSortRunStatus | null
}

export function RootSortStages({ status }: RootSortStagesProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const position = stagePosition(status)
  if (!position) return null
  return (
    <StageTrack
      stages={STAGES}
      labels={STAGES.map((stage) => t(`rootSort.stages.${stage}`))}
      reached={position.reached}
      active={position.active}
      current={Math.min(position.reached, STAGES.length - 1)}
      tone={position.tone}
      data-testid="root-sort-stages"
    />
  )
}

export interface RootSortProgressProps {
  status: WorkingRootSortStatus
  done: number
  total: number
  waiting: boolean
  recent: readonly { name: string; folderPath: string }[]
  remainingSeconds: number | null
  elapsedSeconds: number
}

export function RootSortProgress({
  status,
  done,
  total,
  waiting,
  recent,
  remainingSeconds,
  elapsedSeconds,
}: RootSortProgressProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const counted = status !== 'grouping'
  const percent = total === 0 ? 0 : (done / total) * 100
  return (
    <div className="flex flex-col gap-4 py-2 text-sm" data-testid="root-sort-progress">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <Spinner className="size-4 shrink-0" aria-hidden />
            <span>{t(`rootSort.progress.${status}`)}</span>
          </p>
          {counted && (
            <p className="text-muted-foreground shrink-0 tabular-nums" data-testid="root-sort-count">
              {t('rootSort.progress.count', { done: formatCount(done, locale), total: formatCount(total, locale) })}
            </p>
          )}
        </div>
        {counted && <Progress value={percent} aria-label={t(`rootSort.progress.${status}`)} />}
        <p className="text-muted-foreground min-h-5" aria-live="polite">
          {waiting
            ? t('rootSort.progress.waiting')
            : !counted
              ? t('rootSort.progress.elapsed', { duration: formatDurationElapsed(elapsedSeconds, locale) })
              : done === 0 && status === 'judging'
                ? t('rootSort.progress.starting')
                : remainingSeconds !== null
                  ? t('rootSort.progress.remaining', { duration: formatDurationShort(remainingSeconds, locale) })
                  : null}
        </p>
        {!counted && <p className="text-muted-foreground">{t('rootSort.progress.groupingDetail', { count: total })}</p>}
      </div>

      {status === 'judging' && recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">{t('rootSort.progress.recent')}</p>
          <ul className="flex flex-col gap-1" data-testid="root-sort-recent">
            {recent.map((item) => (
              <li
                key={`${item.name}\u0000${item.folderPath}`}
                aria-label={t('rootSort.progress.recentItem', { name: item.name, folder: item.folderPath })}
                className="animate-in fade-in-0 slide-in-from-top-1 duration-base ease-entrance motion-reduce:animate-none flex min-w-0 items-center gap-2"
              >
                <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{item.name}</span>
                <ArrowRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-muted-foreground min-w-0 truncate">{item.folderPath}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted-foreground">
        {status === 'judging' || status === 'grouping'
          ? t('rootSort.progress.keepOpen')
          : t('rootSort.progress.keepOpenMoving')}
      </p>
    </div>
  )
}

export interface RootSortOutcomeProps {
  moved: number
  failedCount: number
  failedNames: readonly string[]
}

export function RootSortOutcome({ moved, failedCount, failedNames }: RootSortOutcomeProps): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        {moved > 0 && <CheckCircle2 className="text-success size-5 shrink-0" aria-hidden />}
        {t('rootSort.done.moved', { count: moved })}
      </p>
      {failedCount > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-error">{t('rootSort.done.failed', { count: failedCount })}</p>
          <ul className="text-muted-foreground list-disc pl-5">
            {failedNames.map((name, index) => (
              <li key={index} className="break-words">
                {name}
              </li>
            ))}
          </ul>
          {failedCount > failedNames.length && (
            <p className="text-muted-foreground">
              {t('rootSort.done.more', { count: failedCount - failedNames.length })}
            </p>
          )}
        </div>
      )}
      <p className="text-muted-foreground">{t('rootSort.done.foldersKept')}</p>
    </div>
  )
}
