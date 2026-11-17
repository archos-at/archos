import 'server-only'
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { projectIntakes, type NewProjectIntakeRow, type ProjectIntakeRow } from '@/lib/db/schema/project-intakes'
import { withTenant } from '@/lib/db/tenant-context'
import { geocodeResultSchema } from '@/lib/geocoding/types'
import {
  closingIntentSchema,
  dismissedValueSchema,
  documentReadSchema,
  intakeCountsSchema,
  type DismissedValue,
  type DocumentRead,
  type IntakeCounts,
} from './types'

export type { NewProjectIntakeRow, ProjectIntakeRow }

export const MAX_OPEN_INTAKE_LOOKUP = 100

export const MAX_DISMISSED_VALUES = 500

const lenientArray = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((entry) => {
        const parsed = item.safeParse(entry)
        return parsed.success ? [parsed.data as z.infer<T>] : []
      })
    )

const documentsReadColumn = lenientArray(documentReadSchema)
const dismissedColumn = lenientArray(dismissedValueSchema)
const readingFilesColumn = lenientArray(z.string().min(1).max(512))

function toRow(row: ProjectIntakeRow): ProjectIntakeRow {
  return {
    ...row,
    location: geocodeResultSchema.nullable().catch(null).parse(row.location ?? null),
    closing: closingIntentSchema.nullable().catch(null).parse(row.closing ?? null),
    counts: intakeCountsSchema.nullable().catch(null).parse(row.counts ?? null),
    documentsRead: documentsReadColumn.parse(row.documentsRead),
    dismissed: dismissedColumn.parse(row.dismissed),
    readingFiles: readingFilesColumn.parse(row.readingFiles),
  }
}

const first = (rows: ProjectIntakeRow[]): ProjectIntakeRow | null => (rows[0] ? toRow(rows[0]) : null)

const ofProject = (organizationId: string, projectId: string) =>
  and(eq(projectIntakes.organizationId, organizationId), eq(projectIntakes.projectId, projectId))

export async function insertProjectIntake(executor: DbExecutor, row: NewProjectIntakeRow): Promise<ProjectIntakeRow> {
  const [inserted] = await executor.insert(projectIntakes).values(row).returning()
  return toRow(inserted)
}

export async function findProjectIntake(organizationId: string, projectId: string): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().select().from(projectIntakes).where(ofProject(organizationId, projectId)).limit(1)
  )
  return first(rows)
}

export async function findProjectIntakeByJobId(organizationId: string, jobId: string): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(projectIntakes)
      .where(and(eq(projectIntakes.organizationId, organizationId), eq(projectIntakes.jobId, jobId)))
      .limit(1)
  )
  return first(rows)
}

export async function listOpenIntakeProjectIds(organizationId: string, projectIds: readonly string[]): Promise<string[]> {
  const asked = [...new Set(projectIds)].slice(0, MAX_OPEN_INTAKE_LOOKUP)
  if (asked.length === 0) return []
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ projectId: projectIntakes.projectId })
      .from(projectIntakes)
      .where(
        and(
          eq(projectIntakes.organizationId, organizationId),
          inArray(projectIntakes.projectId, asked),
          ne(projectIntakes.status, 'completed')
        )
      )
      .limit(asked.length)
  )
  return rows.map((row) => row.projectId)
}

export interface IntakeReadingClaim {
  jobId: string
  requestedBy: string
  forgetRead: boolean
  now: Date
}

export async function claimIntakeReading(
  organizationId: string,
  projectId: string,
  claim: IntakeReadingClaim
): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({
        status: 'reading',
        jobId: claim.jobId,
        requestedBy: claim.requestedBy,
        traceId: null,
        rerunRequested: false,
        startedAt: claim.now,
        finishedAt: null,
        updatedAt: claim.now,
        readingFiles: [],
        ...(claim.forgetRead ? { documentsRead: [] } : {}),
      })
      .where(and(ofProject(organizationId, projectId), notInArray(projectIntakes.status, ['reading', 'completed'])))
      .returning()
  )
  return first(rows)
}

export async function requestIntakeRerun(organizationId: string, projectId: string): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({ rerunRequested: true, updatedAt: new Date() })
      .where(and(ofProject(organizationId, projectId), eq(projectIntakes.status, 'reading')))
      .returning()
  )
  return first(rows)
}

export async function setIntakeReadingFiles(
  organizationId: string,
  projectId: string,
  jobId: string,
  fileNames: readonly string[]
): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({ readingFiles: [...fileNames], updatedAt: new Date() })
      .where(
        and(ofProject(organizationId, projectId), eq(projectIntakes.jobId, jobId), eq(projectIntakes.status, 'reading'))
      )
      .returning()
  )
  return first(rows)
}

export interface IntakeReadingEnd {
  status: 'ready' | 'failed'
  now: Date
  documentsRead?: DocumentRead[]
  counts?: IntakeCounts
  summary?: string | null
  traceId?: string | null
}

export async function endIntakeReading(
  organizationId: string,
  projectId: string,
  jobId: string,
  end: IntakeReadingEnd
): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({
        status: end.status,
        finishedAt: end.now,
        updatedAt: end.now,
        ...(end.documentsRead ? { documentsRead: end.documentsRead } : {}),
        ...(end.counts ? { counts: end.counts } : {}),
        ...(end.summary !== undefined ? { summary: end.summary } : {}),
        ...(end.traceId !== undefined ? { traceId: end.traceId } : {}),
      })
      .where(
        and(ofProject(organizationId, projectId), eq(projectIntakes.jobId, jobId), eq(projectIntakes.status, 'reading'))
      )
      .returning()
  )
  return first(rows)
}

export async function addIntakeDismissed(
  organizationId: string,
  projectId: string,
  values: readonly DismissedValue[]
): Promise<ProjectIntakeRow | null> {
  if (values.length === 0) return findProjectIntake(organizationId, projectId)
  const appended = sql`${projectIntakes.dismissed} || ${JSON.stringify(values)}::jsonb`
  const kept = sql`(
    SELECT coalesce(jsonb_agg(entry ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(${appended}) WITH ORDINALITY AS item(entry, position)
    WHERE position > jsonb_array_length(${appended}) - ${MAX_DISMISSED_VALUES}
  )`
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({ dismissed: kept, updatedAt: new Date() })
      .where(ofProject(organizationId, projectId))
      .returning()
  )
  return first(rows)
}

export async function completeProjectIntake(
  organizationId: string,
  projectId: string,
  completedBy: string,
  now: Date
): Promise<ProjectIntakeRow | null> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(projectIntakes)
      .set({ status: 'completed', completedAt: now, completedBy, rerunRequested: false, updatedAt: now })
      .where(and(ofProject(organizationId, projectId), ne(projectIntakes.status, 'completed')))
      .returning()
  )
  return first(rows)
}
