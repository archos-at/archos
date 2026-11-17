import 'server-only'
import { and, count, desc, eq, inArray, isNull, lt, max, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents, type Document } from '@/lib/db/schema/documents'
import { officeConventionDecisions, officeConventions, type OfficeConventionsRow } from '@/lib/db/schema/office-conventions'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { proposedChanges } from '@/lib/db/schema/proposed-changes'
import { withTenant } from '@/lib/db/tenant-context'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { fileOperationPayloadSchema } from '@/lib/proposals/types'
import type { OfficeConventions } from './extract'
import { conventionLineSchema } from './office-conventions-wire'
import type { StoredDecision } from './lines'

export const MAX_CONVENTION_DOCUMENTS = 4000

export async function readOfficeConventions(organizationId: string): Promise<OfficeConventionsRow | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb().select().from(officeConventions).where(eq(officeConventions.organizationId, organizationId)).limit(1)
  )
  return row ?? null
}

export async function writeOfficeConventions(
  organizationId: string,
  values: { conventions: OfficeConventions; extractorVersion: number; sourceFingerprint: string }
): Promise<void> {
  const now = new Date()
  const row = { ...values, computedAt: now, updatedAt: now }
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(officeConventions)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({ target: officeConventions.organizationId, set: row })
  )
}

export async function claimOfficeConventionsRefresh(organizationId: string, minIntervalMs: number): Promise<boolean> {
  const now = new Date()
  const claimed = await withTenant({ organizationId }, () =>
    getDb()
      .insert(officeConventions)
      .values({ organizationId, refreshRequestedAt: now })
      .onConflictDoUpdate({
        target: officeConventions.organizationId,
        set: { refreshRequestedAt: now, updatedAt: now },
        setWhere: or(
          isNull(officeConventions.refreshRequestedAt),
          lt(officeConventions.refreshRequestedAt, new Date(now.getTime() - minIntervalMs))
        ),
      })
      .returning({ organizationId: officeConventions.organizationId })
  )
  return claimed.length > 0
}

export async function officeSourceFingerprint(organizationId: string): Promise<string> {
  const [docs, folders] = await withTenant({ organizationId }, () =>
    Promise.all([
      getDb()
        .select({ n: count(), last: max(documents.updatedAt) })
        .from(documents)
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.scope, 'project'),
            documentVisibleTo(SCREENED_ONLY)
          )
        ),
      getDb()
        .select({ n: count(), last: max(projectFolders.updatedAt) })
        .from(projectFolders)
        .where(
          and(
            eq(projectFolders.organizationId, organizationId),
            eq(projectFolders.scope, 'project'),
            isNull(projectFolders.deletedAt)
          )
        ),
    ])
  )
  const stamp = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : '-')
  return `d${Number(docs[0]?.n ?? 0)}@${stamp(docs[0]?.last)};f${Number(folders[0]?.n ?? 0)}@${stamp(folders[0]?.last)}`
}

export async function listConventionDocuments(organizationId: string, projectIds: readonly string[]): Promise<Document[]> {
  if (projectIds.length === 0) return []
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'project'),
          inArray(documents.projectId, [...projectIds]),
          eq(documents.status, 'completed'),
          documentVisibleTo(SCREENED_ONLY)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(MAX_CONVENTION_DOCUMENTS)
  )
}

export const MAX_DECISIONS = 500

export async function listConventionDecisions(organizationId: string): Promise<StoredDecision[]> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(officeConventionDecisions)
      .where(eq(officeConventionDecisions.organizationId, organizationId))
      .orderBy(desc(officeConventionDecisions.decidedAt))
      .limit(MAX_DECISIONS)
  )
  return rows.flatMap((row) => {
    const line = conventionLineSchema.safeParse(row.line)
    if (!line.success || line.data.key !== row.lineKey) return []
    return [{ lineKey: row.lineKey, decision: row.decision, line: line.data, decidedBy: row.decidedBy, decidedAt: new Date(row.decidedAt) }]
  })
}

export async function saveConventionDecision(organizationId: string, decision: Omit<StoredDecision, 'decidedAt'>): Promise<void> {
  const values = { decision: decision.decision, line: decision.line, decidedBy: decision.decidedBy, decidedAt: new Date() }
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(officeConventionDecisions)
      .values({ organizationId, lineKey: decision.lineKey, ...values })
      .onConflictDoUpdate({ target: [officeConventionDecisions.organizationId, officeConventionDecisions.lineKey], set: values })
  )
}

export async function deleteConventionDecision(organizationId: string, lineKey: string): Promise<void> {
  await withTenant({ organizationId }, () =>
    getDb()
      .delete(officeConventionDecisions)
      .where(and(eq(officeConventionDecisions.organizationId, organizationId), eq(officeConventionDecisions.lineKey, lineKey)))
  )
}

export const MAX_ACCEPTED_MOVES = 1000

export interface AcceptedMove {
  projectId: string
  document: string
  folderPath: string
}

export async function listAcceptedMoves(organizationId: string, projectIds: readonly string[]): Promise<AcceptedMove[]> {
  if (projectIds.length === 0) return []
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ projectId: proposedChanges.projectId, payload: proposedChanges.payload })
      .from(proposedChanges)
      .where(
        and(
          eq(proposedChanges.organizationId, organizationId),
          eq(proposedChanges.scope, 'project'),
          eq(proposedChanges.kind, 'file_operation'),
          eq(proposedChanges.status, 'applied'),
          sql`${proposedChanges.payload}->>'operation' = 'move'`,
          inArray(proposedChanges.projectId, [...projectIds])
        )
      )
      .orderBy(desc(proposedChanges.decidedAt))
      .limit(MAX_ACCEPTED_MOVES)
  )
  return rows.flatMap((row) => {
    const payload = fileOperationPayloadSchema.safeParse(row.payload)
    if (!payload.success || !row.projectId) return []
    const projectId = row.projectId
    return payload.data.operations.flatMap((item) => {
      const folderPath = item.target_folder ?? payload.data.new_folder?.path
      return item.document && folderPath && item.source !== 'office' ? [{ projectId, document: item.document, folderPath }] : []
    })
  })
}
