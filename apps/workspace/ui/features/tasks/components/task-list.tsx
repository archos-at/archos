'use client'

import { useId, useRef, type JSX } from 'react'
import { CircleDashed, Inbox } from 'lucide-react'

import { LayoutGroup, motion, springGlide, useMotionToken } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SECTION_READING_COLUMN } from '@/components/shell/section-layout'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { tasksCopy } from '@/i18n/namespaces/tasks'
import { useSwapFade } from '@/hooks/use-swap-fade'
import {
  TASK_FILTERS,
  filterCounts,
  groupByRecency,
  matchesFilter,
  type TaskFilter,
  type TaskRunView,
} from '../lib/task-view'
import { TaskCard } from './task-card'

export interface TaskListProps {
  projectId: string
  tasks: readonly TaskRunView[]
  loading?: boolean
  failed?: boolean
  filter: TaskFilter
  onFilterChange: (filter: TaskFilter) => void
  onSelectTask: (task: TaskRunView) => void
  onRetry?: () => void
}

export function TaskList({
  projectId,
  tasks,
  loading,
  failed,
  filter,
  onFilterChange,
  onSelectTask,
  onRetry,
}: TaskListProps): JSX.Element {
  const t = useTranslations(tasksCopy)
  const counts = filterCounts(tasks)
  const visible = tasks.filter((task) => matchesFilter(task, filter))
  const groups = groupByRecency(visible)
  const swapRef = useRef<HTMLDivElement>(null)
  useSwapFade(swapRef, filter)
  const instanceId = useId()
  const layoutScope = `${instanceId}-${filter}`
  const glide = useMotionToken(springGlide)

  if (loading) {
    return (
      <div className={cn(SECTION_READING_COLUMN, 'py-4 md:py-6')} data-testid="task-list-loading">
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="bg-muted/50 rounded-lg border p-3">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2.5 h-3.5 w-full" />
              <Skeleton className="mt-1.5 h-3.5 w-3/5" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (failed) {
    return (
      <div className={cn(SECTION_READING_COLUMN, 'py-4 md:py-6')}>
        <EmptyState
          icon={CircleDashed}
          tone="destructive"
          title={t('list.errorTitle')}
          description={t('list.errorDescription')}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {t('list.retry')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <div className={cn(SECTION_READING_COLUMN, 'pb-4 pt-3 md:py-6')} data-testid="task-list">
      {/* Counts on the chips, not only in the list: the number is the point of
          `unreviewed`, and a filter a reader has to click to discover is empty
          costs them a click to learn nothing. A zero count still renders — an
          absent number reads as "unknown", which is a different claim. */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(value) => {
          if ((TASK_FILTERS as readonly string[]).includes(value)) onFilterChange(value as TaskFilter)
        }}
        segmented
        size="sm"
        aria-label={t('filters.label')}
        className="mb-4 grid w-full grid-cols-2 gap-0.5 sm:flex sm:w-fit sm:gap-0"
        data-testid="task-filters"
      >
        {TASK_FILTERS.map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            data-testid={`task-filter-${option}`}
            className="shrink-0"
          >
            {t(`filters.${option}`)}
            <CountPill
              tone={option === 'unreviewed' && counts.unreviewed > 0 ? 'attention' : 'muted'}
              count={counts[option]}
            />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* The rows a filter press replaced fade in (`useSwapFade`). */}
      <div ref={swapRef}>
        {visible.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filter === 'all' ? t('list.emptyTitle') : t(`list.emptyFiltered.${filter}`)}
            description={filter === 'all' ? t('list.emptyDescription') : undefined}
            action={
              filter === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => onFilterChange('all')}>
                  {t('filters.showAll')}
                </Button>
              )
            }
          />
        ) : (
          <LayoutGroup key={filter}>
            <div
              className="flex flex-col gap-6"
              data-testid="task-groups"
              data-layout-scope={layoutScope}
            >
              {groups.map((group) => (
                <motion.section
                  key={group.bucket}
                  layout="position"
                  transition={glide}
                  aria-label={t(`buckets.${group.bucket}`)}
                >
                  <SectionLabel as="h2" className="mb-2">
                    {t(`buckets.${group.bucket}`)}
                  </SectionLabel>
                  <div className="flex flex-col gap-3">
                    {group.tasks.map((task) => (
                      <motion.div
                        key={task.id}
                        layout="position"
                        layoutId={`${layoutScope}-${task.id}`}
                        transition={glide}
                        data-layout-id={`${layoutScope}-${task.id}`}
                      >
                        <TaskCard projectId={projectId} task={task} onSelect={onSelectTask} />
                      </motion.div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          </LayoutGroup>
        )}
      </div>
    </div>
  )
}
