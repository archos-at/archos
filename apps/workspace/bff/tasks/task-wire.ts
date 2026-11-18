import { z } from 'zod'
import { DOCUMENT_LIST_CURSOR_MAX_LENGTH } from '@/lib/documents/list-cursor'
import type { RunStatus } from '@/lib/runs/run-ledger-types'
import {
  TASK_RUN_STATUSES,
  type TaskKind,
  type TaskReview,
  type TaskRunStatus,
  type TaskRunTrigger,
} from './task-vocabulary'

export const TASK_PAGE_DEFAULT_LIMIT = 50
export const TASK_PAGE_MAX_LIMIT = 200

const limitParam = z.coerce
  .number()
  .int()
  .min(1)
  .max(TASK_PAGE_MAX_LIMIT)
  .default(TASK_PAGE_DEFAULT_LIMIT)

const cursorParam = z.string().min(1).max(DOCUMENT_LIST_CURSOR_MAX_LENGTH).optional()

export const taskListQuerySchema = z.object({ limit: limitParam, cursor: cursorParam })
export type TaskListQuery = z.infer<typeof taskListQuerySchema>

export const TASK_RUN_REVIEW_FILTERS = ['none', 'accepted', 'rejected'] as const
export type TaskRunReviewFilter = (typeof TASK_RUN_REVIEW_FILTERS)[number]

export const taskRunListQuerySchema = z.object({
  limit: limitParam,
  cursor: cursorParam,
  taskId: z.guid().optional(),
  status: z.enum(TASK_RUN_STATUSES).optional(),
  review: z.enum(TASK_RUN_REVIEW_FILTERS).optional(),
})
export type TaskRunListQuery = z.infer<typeof taskRunListQuerySchema>

export const runViewQuerySchema = z.object({
  include: z.enum(['stream']).optional().describe('Browser only.'),
})
export type RunViewQuery = z.infer<typeof runViewQuerySchema>

export const RUN_REPORT_MAX_CHARS = 20_000

export interface TaskView {
  id: string
  projectId: string
  name: string
  prompt: string
  skillName: string | null
  output: 'chat' | 'deep-research'
  dataSources: string[] | null
  enabled: boolean
  scheduleCron: string | null
  scheduleTimezone: string
  dueAt: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TaskRunSummary {
  status: RunStatus
  rounds: number
  docs: number
}

export interface TaskRunView {
  id: string
  taskId: string | null
  kind: TaskKind
  title: string
  goal: string | null
  status: TaskRunStatus
  review: TaskReview | null
  reviewReason: string | null
  filedDocumentId: string | null
  conversationId: string | null
  runMessageId: string | null
  trigger: TaskRunTrigger
  requesterUserId: string
  requesterName: string | null
  createdAt: string
  finishedAt: string | null
  error: string | null
  runSummary?: TaskRunSummary | null
}

export interface TaskPage {
  tasks: TaskView[]
  nextCursor: string | null
}

export interface TaskRunPage {
  runs: TaskRunView[]
  nextCursor: string | null
}
