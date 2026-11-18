import 'server-only'
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { MAIL_IMPORT_LIFECYCLE, mailImports, type MailImport, type MailImportSkippedSample, type MailImportStatus, type NewMailImport } from '@/lib/db/schema/mail-imports'
import { CURSOR_TIMESTAMP_FORMAT, type DocumentListCursor } from '@/lib/documents/list-cursor'
import { isUuid } from '@/lib/ids'

const OPEN_STATUSES: MailImportStatus[] = [...MAIL_IMPORT_LIFECYCLE.liveStates]
const ENDED_STATUSES: MailImportStatus[] = [...MAIL_IMPORT_LIFECYCLE.finalStates]

export async function insertMailImport(values: NewMailImport): Promise<MailImport | null> {
  const rows = await withTenant({ organizationId: values.organizationId }, () =>
    getDb().insert(mailImports).values(values).onConflictDoNothing().returning(),
  )
  return rows[0] ?? null
}

export async function findMailImport(organizationId: string, projectId: string, id: string): Promise<MailImport | null> {
  if (!isUuid(id)) return null
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(mailImports)
      .where(and(eq(mailImports.id, id), eq(mailImports.projectId, projectId)))
      .limit(1),
  )
  return row ?? null
}

export interface MailImportPage {
  rows: MailImport[]
  next: DocumentListCursor | null
}

export async function listProjectMailImports(
  organizationId: string,
  projectId: string,
  page: { limit: number; cursor: DocumentListCursor | null },
): Promise<MailImportPage> {
  const fetched = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        row: mailImports,
        cursorAt: sql<string>`to_char(${mailImports.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
      })
      .from(mailImports)
      .where(
        and(
          eq(mailImports.organizationId, organizationId),
          eq(mailImports.projectId, projectId),
          afterCursor(page.cursor),
        ),
      )
      .orderBy(desc(mailImports.createdAt), desc(mailImports.id))
      .limit(page.limit + 1),
  )
  const kept = fetched.slice(0, page.limit)
  const last = kept.at(-1)
  return {
    rows: kept.map((entry) => entry.row),
    next: fetched.length > page.limit && last ? { createdAt: String(last.cursorAt), id: last.row.id } : null,
  }
}

function afterCursor(cursor: DocumentListCursor | null): SQL | undefined {
  if (!cursor) return undefined
  return sql`(${mailImports.createdAt}, ${mailImports.id}) < ((${cursor.createdAt})::timestamp AT TIME ZONE 'UTC', ${cursor.id}::uuid)`
}

export async function findOpenMailImportOf(
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<MailImport | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(mailImports)
      .where(
        and(
          eq(mailImports.organizationId, organizationId),
          eq(mailImports.projectId, projectId),
          eq(mailImports.userId, userId),
          inArray(mailImports.status, OPEN_STATUSES),
        ),
      )
      .limit(1),
  )
  return row ?? null
}

export type MailImportPatch = Partial<
  Pick<
    MailImport,
    | 'status'
    | 'uploadId'
    | 'stagingDeletedAt'
    | 'rootFolderId'
    | 'totalItems'
    | 'errorCode'
    | 'lastError'
    | 'failureStreak'
    | 'completedAt'
    | 'inflightPosition'
    | 'inflightFolderId'
  >
>

export async function updateMailImport(
  organizationId: string,
  id: string,
  from: readonly MailImportStatus[],
  patch: MailImportPatch,
): Promise<MailImport | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .update(mailImports)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(mailImports.id, id), inArray(mailImports.status, [...from])))
      .returning(),
  )
  return row ?? null
}

export async function markInflight(
  organizationId: string,
  id: string,
  position: number,
  folderId: string,
): Promise<boolean> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(mailImports)
      .set({ inflightPosition: position, inflightFolderId: folderId, updatedAt: new Date() })
      .where(and(eq(mailImports.id, id), eq(mailImports.status, 'importing'), eq(mailImports.nextPosition, position)))
      .returning({ id: mailImports.id }),
  )
  return rows.length > 0
}

export interface MailImportAdvance {
  to: number
  mailsFiled: number
  filesFiled: number
  itemsSkipped: number
  filesSkipped: number
  threadsCreated: number
  threadsAppended: number
  alreadyInProject: number
  skippedSamples: MailImportSkippedSample[]
}

export async function advanceMailImport(
  organizationId: string,
  id: string,
  from: number,
  advance: MailImportAdvance,
): Promise<boolean> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(mailImports)
      .set({
        nextPosition: advance.to,
        mailsFiled: sql`${mailImports.mailsFiled} + ${advance.mailsFiled}`,
        filesFiled: sql`${mailImports.filesFiled} + ${advance.filesFiled}`,
        itemsSkipped: sql`${mailImports.itemsSkipped} + ${advance.itemsSkipped}`,
        filesSkipped: sql`${mailImports.filesSkipped} + ${advance.filesSkipped}`,
        threadsCreated: sql`${mailImports.threadsCreated} + ${advance.threadsCreated}`,
        threadsAppended: sql`${mailImports.threadsAppended} + ${advance.threadsAppended}`,
        alreadyInProject: sql`${mailImports.alreadyInProject} + ${advance.alreadyInProject}`,
        skippedSamples: advance.skippedSamples,
        failureStreak: 0,
        inflightPosition: null,
        inflightFolderId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mailImports.id, id), eq(mailImports.status, 'importing'), eq(mailImports.nextPosition, from)))
      .returning({ id: mailImports.id }),
  )
  return rows.length > 0
}

export async function recordSkippedFiles(
  organizationId: string,
  id: string,
  count: number,
  skippedSamples: MailImportSkippedSample[],
): Promise<boolean> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .update(mailImports)
      .set({ filesSkipped: sql`${mailImports.filesSkipped} + ${count}`, skippedSamples, updatedAt: new Date() })
      .where(and(eq(mailImports.id, id), inArray(mailImports.status, OPEN_STATUSES)))
      .returning({ id: mailImports.id }),
  )
  return rows.length > 0
}

export async function listStaleOpenImports(
  uploadsBefore: Date,
  stalledBefore: Date,
  limit: number,
): Promise<MailImport[]> {
  const db = getDb()
  const open = await db
    .select()
    .from(mailImports)
    .where(
      or(
        and(eq(mailImports.status, 'uploading'), lt(mailImports.updatedAt, uploadsBefore)),
        and(inArray(mailImports.status, ['queued', 'importing']), lt(mailImports.updatedAt, stalledBefore)),
      ),
    )
    .orderBy(mailImports.updatedAt)
    .limit(limit)
  const undeleted = await db
    .select()
    .from(mailImports)
    .where(
      and(
        inArray(mailImports.status, ENDED_STATUSES),
        isNull(mailImports.stagingDeletedAt),
        lt(mailImports.updatedAt, stalledBefore),
      ),
    )
    .orderBy(mailImports.updatedAt)
    .limit(limit)
  return [...open, ...undeleted]
}
