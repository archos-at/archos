import { z } from 'zod'
import { planDocumentsSchema } from '@/lib/runs/plan-documents'
import { DELEGATABLE_TASK_KINDS } from '@/lib/db/schema/task-model'
import { canonicalTaskKind } from './task-vocabulary'

export const TASK_GOAL_MAX_CHARS = 500

export const RESEARCH_CONTEXT_MAX_CHARS = 8_000

export const internalTaskRequestSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create'),
      projectId: z.guid(),
      kind: z.preprocess(canonicalTaskKind, z.enum(DELEGATABLE_TASK_KINDS)),
      goal: z.string().trim().min(1).max(TASK_GOAL_MAX_CHARS),
      due: z.string().trim().min(4).max(40).optional(),
      cadence: z.string().trim().min(1).max(120).optional(),
      cadenceTimezone: z.string().trim().min(1).max(80).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('research'),
      projectId: z.guid(),
      question: z.string().trim().min(1).max(TASK_GOAL_MAX_CHARS),
      context: z.string().trim().min(1).max(RESEARCH_CONTEXT_MAX_CHARS).optional(),
      dataSources: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
      documents: planDocumentsSchema.optional(),
    })
    .strict(),
])

export type InternalTaskRequest = z.infer<typeof internalTaskRequestSchema>

export const internalTaskResponseSchema = z.object({
  taskId: z.string(),
  kind: z.enum(DELEGATABLE_TASK_KINDS),
  title: z.string(),
  status: z.string(),
  conversationId: z.string().nullable(),
  dueAt: z.string().nullable(),
  scheduled: z.boolean(),
  nextRunAt: z.string().nullable(),
})

export type InternalTaskResponse = z.infer<typeof internalTaskResponseSchema>

export const internalResearchResponseSchema = z.object({
  runId: z.string(),
  runMessageId: z.string().nullable(),
  conversationId: z.string(),
  status: z.string(),
})

export type InternalResearchResponse = z.infer<typeof internalResearchResponseSchema>

export function parseTaskDue(due: string | undefined): Date | null {
  if (!due) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due)
  const parsed = new Date(dateOnly ? `${due}T23:59:59.999Z` : due)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
