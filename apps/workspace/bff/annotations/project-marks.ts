import 'server-only'
import { z } from 'zod'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds, getRestrictedFolderIds } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { Document } from '@/lib/db/schema/documents'
import { canWriteDocument } from '@/lib/documents/can-write'
import { documentDisplayName } from '@/lib/documents/display-name'
import { officeTimeZone } from '@/lib/organizations/time-zone'
import { addCalendarDays, calendarDayIn } from '@/lib/format'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { inPool } from '@/lib/utils/in-pool'
import {
  listProjectAnnotationPage,
  selectionReachesRestrictedDocuments,
  type DueRange,
  type ProjectAnnotationRecord,
  type ProjectMarkCursor,
} from './project-repository'
import {
  ASSIGNEE_ME,
  DUE_SOON_DAYS,
  PROJECT_MARKS_CURSOR_MAX_LENGTH,
  type ProjectMarkDue,
  type ProjectMarkStatus,
  type ProjectMarksQuery,
  type ProjectMarksResponse,
  type ProjectMarkView,
} from './project-types'
import { annotationDirectory, documentAnnotationViews } from './service'
import { LIVE_ANNOTATION_STATUSES, type AnnotationStatus } from './types'

const STATUSES: Record<ProjectMarkStatus, readonly AnnotationStatus[]> = {
  open: ['open'],
  proposed: ['proposed'],
  'all-live': LIVE_ANNOTATION_STATUSES,
}

const DOCUMENTS_AT_ONCE = 8

export function dueRangeOf(due: ProjectMarkDue | undefined, today: string): DueRange | null {
  if (due === 'overdue') return { before: today }
  if (due === 'soon') return { from: today, through: addCalendarDays(today, DUE_SOON_DAYS) }
  return null
}

const cursorSchema = z.object({
  u: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  n: z.string().max(PROJECT_MARKS_CURSOR_MAX_LENGTH),
  d: z.guid(),
  k: z.number().int().min(0),
})

export function encodeProjectMarkCursor(cursor: ProjectMarkCursor): string {
  return Buffer.from(
    JSON.stringify({ u: cursor.due, n: cursor.name, d: cursor.documentId, k: cursor.number }),
    'utf8'
  ).toString('base64url')
}

export function decodeProjectMarkCursor(encoded: string): ProjectMarkCursor {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    // Falls through to the refusal below.
  }
  const result = cursorSchema.safeParse(parsed)
  if (!result.success) throw new BadRequestError('Invalid cursor.', { field: 'cursor' })
  return { due: result.data.u, name: result.data.n, documentId: result.data.d, number: result.data.k }
}

function byDocument(records: readonly ProjectAnnotationRecord[]): { doc: Document; records: ProjectAnnotationRecord[] }[] {
  const groups = new Map<string, { doc: Document; records: ProjectAnnotationRecord[] }>()
  for (const record of records) {
    const group = groups.get(record.documentId) ?? { doc: record.document, records: [] }
    group.records.push(record)
    groups.set(record.documentId, group)
  }
  return [...groups.values()]
}

export async function listProjectAnnotations(
  session: AuthorizedSession,
  projectId: string,
  query: ProjectMarksQuery,
  now: Date = new Date()
): Promise<ProjectMarksResponse> {
  await requireProjectAccess(session, projectId, 'project:view')
  const cursor = query.cursor ? decodeProjectMarkCursor(query.cursor) : null
  const [reader, hiddenFolderIds, timeZone] = await Promise.all([
    shelfReaderFor(session, { scope: 'project', projectId }),
    getHiddenFolderIds(session, projectId),
    officeTimeZone(session.organizationId),
  ])
  const selection = {
    reader,
    hiddenFolderIds,
    statuses: STATUSES[query.status],
    assigneeUserId: query.assignee === ASSIGNEE_ME ? session.userId : (query.assignee ?? null),
    due: dueRangeOf(query.due, calendarDayIn(timeZone, now)),
  }
  const page = await listProjectAnnotationPage(session.organizationId, projectId, {
    ...selection,
    order: query.order,
    cursor,
    limit: query.limit,
  })
  if (page.records.length === 0) return { marks: [], nextCursor: null, ...(cursor ? {} : { restricted: false }) }
  const restricted = cursor
    ? undefined
    : await selectionReachesRestrictedDocuments(session.organizationId, projectId, {
        ...selection,
        restrictedFolderIds: await getRestrictedFolderIds(session.organizationId, projectId),
      })

  const names = await annotationDirectory(session.organizationId)
  const projected = await inPool(byDocument(page.records), DOCUMENTS_AT_ONCE, async ({ doc, records }) =>
    documentAnnotationViews(session, doc, records, { writable: await canWriteDocument(session, doc.id), names })
  )
  const views = new Map(projected.flat().map((view) => [view.id, view]))
  const marks: ProjectMarkView[] = page.records.flatMap((record) => {
    const view = views.get(record.id)
    return view ? [{ ...view, documentName: documentDisplayName(record.document) }] : []
  })
  return {
    marks,
    nextCursor: page.next ? encodeProjectMarkCursor(page.next) : null,
    ...(restricted === undefined ? {} : { restricted }),
  }
}
