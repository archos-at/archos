import { z } from 'zod'
import { PLATFORM_LESSON_ROOT_CAUSE_STATUSES, type PlatformLesson } from '@/lib/db/schema/platform-lessons'

export const MAX_DISTILL_QUESTION_CHARS = 600
export const MAX_DISTILL_ANSWER_CHARS = 1500
export const MAX_DISTILL_COMMENT_CHARS = 600
export const MAX_DISTILL_REGISTER_SIZE = 60

export const updateLessonSchema = z
  .object({
    status: z.enum(['active', 'retired']).optional(),
    content: z.string().trim().min(1).max(500).optional(),
    rootCauseStatus: z.enum(PLATFORM_LESSON_ROOT_CAUSE_STATUSES).optional(),
    rootCauseNote: z.string().trim().max(1000).nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch.' })

export type UpdateLessonInput = z.infer<typeof updateLessonSchema>

export interface DistillOutcome {
  matchLessonId: string | null
  lesson: string | null
  canonicalSummary: string | null
  category: 'inaccurate' | 'too_slow' | 'wrong_source' | 'other'
  generalizable: boolean
  auditPassed: boolean
  error: string | null
}

export interface PlatformLessonView {
  id: string
  content: string
  category: PlatformLesson['category']
  status: PlatformLesson['status']
  heldReason: string | null
  reportCount: number
  orgCount: number
  firstReportedAt: string
  lastReportedAt: string
  activatedAt: string | null
  activatedBy: string | null
  retiredAt: string | null
  retiredReason: string | null
  rootCauseStatus: PlatformLesson['rootCauseStatus']
  rootCauseNote: string | null
  createdAt: string
  updatedAt: string
}

export function toLessonView(row: PlatformLesson): PlatformLessonView {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    status: row.status,
    heldReason: row.heldReason ?? null,
    reportCount: row.reportCount,
    orgCount: row.orgCount,
    firstReportedAt: row.firstReportedAt.toISOString(),
    lastReportedAt: row.lastReportedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    activatedBy: row.activatedBy ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    retiredReason: row.retiredReason ?? null,
    rootCauseStatus: row.rootCauseStatus,
    rootCauseNote: row.rootCauseNote ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
