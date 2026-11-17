'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarRange, ListChecks, MessageSquare, Plus } from 'lucide-react'

import { ProjectSectionActions } from '@/components/shell/project-section-frame'
import { SERIES_SLOT_COUNT } from '@/components/charts/palette'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SECTION_READING_COLUMN } from '@/components/shell/section-layout'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { tasksCopy } from '@/i18n/namespaces/tasks'
import { listJobs, listProjectRuns, type Job } from '@/adapters/api/jobs-client'
import type { ScheduleDraft } from '@/features/jobs/lib/schedule-draft'
import { seriesColorsFor } from '@/features/jobs/lib/timetable'
import { ScheduleCard } from '@/features/jobs/components/schedule-card'
import { ScheduleDetail } from '@/features/jobs/components/schedule-detail'
import { ScheduleTimetable } from '@/features/jobs/components/schedule-timetable'
import { ScheduleWizard } from '@/features/jobs/components/schedule-wizard'
import { TaskDetail } from './task-detail'
import { TaskList } from './task-list'
import { type TaskFilter, type TaskRunView } from '../lib/task-view'
import { type TasksView } from '../lib/tasks-view'

const RUN_LIST_PAGE = 200

export const TASKS_POLL_MS = 10_000

interface TasksPanelProps {
  projectId: string
  canManageJobs: boolean
  canChatInProject?: boolean
  initialView?: TasksView
}

function readTaskSelectionFromUrl(): string | null {
  try {
    if (typeof window === 'undefined') return null
    return new URL(window.location.href).searchParams.get('task')
  } catch {
    return null
  }
}

function readScheduleSelectionFromUrl(): string | null {
  try {
    if (typeof window === 'undefined') return null
    return new URL(window.location.href).searchParams.get('schedule')
  } catch {
    return null
  }
}

function readViewFromUrl(): TasksView | null {
  try {
    if (typeof window === 'undefined') return null
    const value = new URL(window.location.href).searchParams.get('view')
    return value === 'list' || value === 'timetable' ? value : null
  } catch {
    return null
  }
}

function syncStateToUrl(taskId: string | null, scheduleId: string | null, view: TasksView): void {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('task')
    url.searchParams.delete('schedule')
    if (taskId) url.searchParams.set('task', taskId)
    if (scheduleId) url.searchParams.set('schedule', scheduleId)
    url.searchParams.set('view', view)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // History unavailable (embedded preview) — panels still work.
  }
}

export function TasksPanel({
  projectId,
  canManageJobs,
  canChatInProject = true,
  initialView = 'list',
}: TasksPanelProps): JSX.Element {
  const t = useTranslations(tasksCopy)
  const tJobs = useTranslations(jobsCopy)
  const tChat = useTranslations(chatCopy)
  const [tasks, setTasks] = useState<readonly TaskRunView[]>([])
  const [jobs, setJobs] = useState<readonly Job[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [jobsFailed, setJobsFailed] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [view, setView] = useState<TasksView>(() => readViewFromUrl() ?? initialView)
  const [mode, setMode] = useState<'list' | 'wizard'>('list')
  const [editing, setEditing] = useState<Job | null>(null)
  const [wizardDraft, setWizardDraft] = useState<ScheduleDraft | null>(null)
  const [selectedTask, setSelectedTask] = useState<string | null>(() => readTaskSelectionFromUrl())
  const [selectedSchedule, setSelectedSchedule] = useState<string | null>(() =>
    readTaskSelectionFromUrl() ? null : readScheduleSelectionFromUrl(),
  )

  const firstLoadRef = useRef(true)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)
  const projectIdRef = useRef(projectId)
  const taskEverResolvedRef = useRef(false)
  const scheduleEverResolvedRef = useRef(false)

  const loadTasks = useCallback(
    async (quiet: boolean, startedFor: number): Promise<void> => {
      try {
        const rows = await listProjectRuns(projectId, { limit: RUN_LIST_PAGE })
        if (startedFor !== generationRef.current) return
        setTasks(rows)
        setFailed(false)
      } catch {
        if (startedFor !== generationRef.current) return
        if (!quiet) setFailed(true)
      }
    },
    [projectId],
  )

  const loadJobs = useCallback(
    async (quiet: boolean, startedFor: number): Promise<void> => {
      try {
        const next = await listJobs(projectId)
        if (startedFor !== generationRef.current) return
        setJobs(next)
        setJobsFailed(false)
      } catch {
        if (startedFor !== generationRef.current) return
        if (!quiet) setJobsFailed(true)
      }
    },
    [projectId],
  )

  const load = useCallback(
    async (quiet: boolean): Promise<void> => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }
      inFlightRef.current = true
      const startedFor = generationRef.current
      try {
        await loadTasks(quiet, startedFor)
        await loadJobs(quiet, startedFor)
      } finally {
        if (startedFor === generationRef.current) {
          inFlightRef.current = false
          if (firstLoadRef.current) {
            firstLoadRef.current = false
            setLoading(false)
          }
          if (pendingRef.current) {
            pendingRef.current = false
            void load(true)
          }
        }
      }
    },
    [loadTasks, loadJobs],
  )

  useEffect(() => {
    generationRef.current += 1
    if (projectIdRef.current !== projectId) {
      projectIdRef.current = projectId
      setSelectedTask(null)
      setSelectedSchedule(null)
      syncStateToUrl(null, null, view)
    }
    firstLoadRef.current = true
    inFlightRef.current = false
    setLoading(true)
    setFailed(false)
    setJobsFailed(false)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }

    const reschedule = () => {
      clearTimer()
      if (cancelled || document.visibilityState !== 'visible') return
      timer = setTimeout(tick, TASKS_POLL_MS)
    }

    const tick = () => {
      if (cancelled) return
      void load(true).finally(() => {
        if (cancelled) return
        if (document.visibilityState === 'visible') reschedule()
        else clearTimer()
      })
    }

    const onVisibilityChange = () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') {
        clearTimer()
        return
      }
      if (inFlightRef.current) return
      clearTimer()
      void load(true).finally(() => {
        if (!cancelled) reschedule()
      })
    }

    const onFocus = () => {
      if (!cancelled) void load(true)
    }

    void load(false).finally(() => {
      if (!cancelled) reschedule()
    })
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, load])

  const selectView = useCallback(
    (next: TasksView) => {
      setView(next)
      syncStateToUrl(selectedTask, selectedSchedule, next)
    },
    [selectedTask, selectedSchedule],
  )

  const openTaskDetail = useCallback((task: TaskRunView) => {
    setSelectedTask(task.id)
    setSelectedSchedule(null)
  }, [])

  const closeTaskDetail = useCallback(() => {
    setSelectedTask(null)
  }, [])

  const openScheduleDetail = useCallback((job: Job) => {
    setSelectedSchedule(job.id)
    setSelectedTask(null)
  }, [])

  const closeScheduleDetail = useCallback(() => {
    setSelectedSchedule(null)
  }, [])

  useEffect(() => {
    syncStateToUrl(selectedTask, selectedSchedule, view)
  }, [selectedTask, selectedSchedule, view])

  const openCreate = useCallback(() => {
    setEditing(null)
    setWizardDraft(null)
    setMode('wizard')
  }, [])

  const openEdit = useCallback((job: Job) => {
    setSelectedSchedule(null)
    setWizardDraft(null)
    setEditing(job)
    setMode('wizard')
  }, [])

  const backToList = useCallback(() => {
    setEditing(null)
    setWizardDraft(null)
    setMode('list')
  }, [])

  const handleSaved = useCallback(() => {
    void load(true)
    backToList()
  }, [load, backToList])

  const handleJobChanged = useCallback((next: Job) => {
    setJobs((prev) => prev.map((job) => (job.id === next.id ? next : job)))
  }, [])

  const handleJobDeleted = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== jobId))
    setSelectedSchedule(null)
  }, [])

  const handlePromoteToTask = useCallback(
    (draft: ScheduleDraft) => {
      setSelectedTask(null)
      setWizardDraft(draft)
      setEditing(null)
      setMode('wizard')
    },
    [],
  )

  const resolvedTask = selectedTask === null ? null : (tasks.find((row) => row.id === selectedTask) ?? null)
  const resolvedSchedule =
    selectedSchedule === null ? null : (jobs.find((job) => job.id === selectedSchedule) ?? null)

  useEffect(() => {
    taskEverResolvedRef.current = false
  }, [selectedTask])

  useEffect(() => {
    if (resolvedTask !== null) taskEverResolvedRef.current = true
  }, [resolvedTask])

  useEffect(() => {
    scheduleEverResolvedRef.current = false
  }, [selectedSchedule])

  useEffect(() => {
    if (resolvedSchedule !== null) scheduleEverResolvedRef.current = true
  }, [resolvedSchedule])

  const taskGoneReason = taskEverResolvedRef.current ? 'deleted' : 'unresolved'
  const scheduleGoneReason = scheduleEverResolvedRef.current ? 'deleted' : 'unresolved'
  const chatHref = `/app/projects/${encodeURIComponent(projectId)}/chat`

  const accentOf = useMemo(() => {
    const slots = seriesColorsFor(jobs, SERIES_SLOT_COUNT)
    return (jobId: string): string | undefined => slots.get(jobId)
  }, [jobs])

  const isList = mode === 'list'
  const isTimetableView = view === 'timetable'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tasks-panel">
      <ProjectSectionActions>
        {isList ? (
          <>
            {/* ONE create gesture: a task, whose third wizard step asks WHEN —
                answered with a rhythm it becomes a scheduled task, unanswered a
                manual one. There is no separate thing called a Zeitplan to
                create. Without `project:skills:manage` the reader gets no
                button rather than a dead end; the server enforces again. */}
            {canManageJobs ? (
              <Button size="sm" onClick={openCreate} data-testid="tasks-new">
                <Plus className="size-4" aria-hidden />
                {t('create.task')}
              </Button>
            ) : null}
            {/* One-shot delegation happens IN the chat — this only links there.
                Without `project:chat` the composer is locked for this reader, so
                the link is disabled with the locked composer's own reason instead
                of landing them in a dead end. A mirrored affordance, not a gate:
                the server still enforces on send. The title rides the wrapping span
                because a disabled button takes no pointer events. */}
            {canChatInProject ? (
              <Button size="sm" variant="secondary" asChild title={t('create.delegateHint')}>
                <Link href={chatHref} data-testid="tasks-delegate">
                  <MessageSquare className="size-4" aria-hidden />
                  {t('create.delegate')}
                </Link>
              </Button>
            ) : (
              <span title={tChat('composer.noProjectChatPermission')}>
                <Button size="sm" variant="secondary" disabled data-testid="tasks-delegate">
                  <MessageSquare className="size-4" aria-hidden />
                  {t('create.delegate')}
                </Button>
              </span>
            )}
          </>
        ) : (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={backToList}>
            <ArrowLeft className="size-4" aria-hidden />
            {tJobs('backToList')}
          </Button>
        )}
      </ProjectSectionActions>

      {isList ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Liste and Zeitplan read the same tasks: the toggle is a preference
              that rides `?view=`, never a destination. */}
          <div className={cn(SECTION_READING_COLUMN, 'pt-4')}>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => {
                if (value === 'list' || value === 'timetable') selectView(value)
              }}
              segmented
              size="sm"
              aria-label={t('view.label')}
              data-testid="tasks-view-toggle"
            >
              <ToggleGroupItem value="list" data-testid="tasks-view-list">
                <ListChecks className="size-4" aria-hidden />
                {t('view.list')}
              </ToggleGroupItem>
              <ToggleGroupItem value="timetable" data-testid="tasks-view-timetable">
                <CalendarRange className="size-4" aria-hidden />
                {t('view.timetable')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {isTimetableView ? (
            <div className="usage-viz listing-container p-4 md:px-8 md:py-6">
              <ScheduleTimetable
                schedules={jobs}
                loading={loading}
                onSelect={openScheduleDetail}
              />
              <StandingTasksSection
                jobs={jobs}
                loading={loading}
                failed={jobsFailed}
                canManageJobs={canManageJobs}
                accentOf={accentOf}
                onChanged={handleJobChanged}
                onSelect={openScheduleDetail}
                onCreate={openCreate}
                onRetry={() => void load(false)}
              />
            </div>
          ) : (
            <>
              <TaskList
                projectId={projectId}
                tasks={tasks}
                loading={loading}
                failed={failed}
                filter={filter}
                onFilterChange={setFilter}
                onSelectTask={openTaskDetail}
                onRetry={() => {
                  firstLoadRef.current = true
                  setLoading(true)
                  void load(false)
                }}
              />
              <StandingTasksSection
                jobs={jobs}
                loading={loading}
                failed={jobsFailed}
                canManageJobs={canManageJobs}
                accentOf={accentOf}
                onChanged={handleJobChanged}
                onSelect={openScheduleDetail}
                onCreate={openCreate}
                onRetry={() => void load(false)}
              />
            </>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <ScheduleWizard
            projectId={projectId}
            job={editing}
            draft={wizardDraft}
            onSaved={handleSaved}
            onCancel={backToList}
          />
        </div>
      )}

      <TaskDetail
        projectId={projectId}
        task={resolvedTask}
        open={selectedTask !== null}
        goneReason={taskGoneReason}
        resolving={selectedTask !== null && resolvedTask === null && loading}
        canManageJobs={canManageJobs}
        onPromoteToTask={handlePromoteToTask}
        onClose={closeTaskDetail}
      />
      <ScheduleDetail
        projectId={projectId}
        job={resolvedSchedule}
        open={selectedSchedule !== null}
        canManage={canManageJobs}
        goneReason={scheduleGoneReason}
        resolving={selectedSchedule !== null && resolvedSchedule === null && loading}
        onChanged={handleJobChanged}
        onDeleted={handleJobDeleted}
        onEdit={openEdit}
        onClose={closeScheduleDetail}
      />
    </div>
  )
}

interface StandingTasksSectionProps {
  jobs: readonly Job[]
  loading: boolean
  failed: boolean
  canManageJobs: boolean
  accentOf: (jobId: string) => string | undefined
  onChanged: (next: Job) => void
  onSelect: (job: Job) => void
  onCreate: () => void
  onRetry: () => void
}

function StandingTasksSection({
  jobs,
  loading,
  failed,
  canManageJobs,
  accentOf,
  onChanged,
  onSelect,
  onCreate,
  onRetry,
}: StandingTasksSectionProps): JSX.Element {
  const t = useTranslations(tasksCopy)
  const tJobs = useTranslations(jobsCopy)

  return (
    <section
      className={cn(SECTION_READING_COLUMN, 'pb-4 pt-2')}
      aria-label={t('standing.heading')}
    >
      <SectionLabel as="h2" className="mb-2">
        {t('standing.heading')}
      </SectionLabel>
      {loading ? (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="standing-loading" aria-hidden="true">
          {[0, 1].map((row) => (
            <div key={row} className="bg-muted/50 rounded-lg border p-3">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2.5 h-3.5 w-3/5" />
              <Skeleton className="mt-1.5 h-3.5 w-2/5" />
            </div>
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={CalendarRange}
          tone="destructive"
          title={tJobs('loadError')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry} data-attr="jobs-retry">
              {tJobs('tryAgain')}
            </Button>
          }
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title={t('standing.emptyTitle')}
          description={t('standing.emptyDescription')}
          action={
            canManageJobs ? (
              <Button size="sm" onClick={onCreate}>
                <Plus className="size-4" aria-hidden />
                {t('create.task')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="standing-cards">
          {jobs.map((job) => (
            <ScheduleCard
              key={job.id}
              job={job}
              canManage={canManageJobs}
              accent={accentOf(job.id)}
              onChanged={onChanged}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}
