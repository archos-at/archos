import 'server-only'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { executeRows } from '@/lib/db/execute-rows'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { messages } from '@/lib/db/schema/messages'
import { projectMemory } from '@/lib/db/schema/project-memory'

export const REMOVED_ANSWER_TEXT = 'Inhalt entfernt: Quelle gelöscht'

export interface DocumentSourceRef {
  id: string
  collectionName: string
  filename: string
}

export interface DerivedAnswer {
  messageId: string
  conversationId: string
}

const PAGE = 1_000

const REF_SEPARATOR = '\u001f'

export async function findAnswersDrawingOn(
  organizationId: string,
  projectId: string,
  docs: readonly DocumentSourceRef[],
  rootFolderId: string
): Promise<DerivedAnswer[]> {
  const db = getDb()
  const ids = docs.map((doc) => doc.id)
  const refs = docs.map((doc) => `${doc.collectionName}${REF_SEPARATOR}${doc.filename}`)
  const names = [...new Set(docs.map((doc) => doc.filename))]
  const found: DerivedAnswer[] = []
  let afterId = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const rows = executeRows<{ id: string; conversation_id: string }>(
      await withTenant({ organizationId }, () =>
        db.execute(sql`
          SELECT m.id, m.conversation_id
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id AND c.organization_id = m.organization_id
          WHERE m.organization_id = ${organizationId}
            AND c.project_id = ${projectId}::uuid
            AND m.role = 'assistant'
            AND m.metadata IS NOT NULL
            AND m.id > ${afterId}::uuid
            AND (
              m.metadata #>> '{sourceDeleted,folderId}' = ${rootFolderId}
              OR m.metadata #>> '{sourceRemoved,folderId}' = ${rootFolderId}
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(m.metadata #> '{citations,sources}') = 'array'
                       THEN m.metadata #> '{citations,sources}' ELSE '[]'::jsonb END
                  || CASE WHEN jsonb_typeof(m.metadata #> '{readSources,sources}') = 'array'
                       THEN m.metadata #> '{readSources,sources}' ELSE '[]'::jsonb END
                ) AS src
                WHERE (src ->> 'document_id') = ANY(${`{${ids.join(',')}}`}::text[])
                   OR ((src ->> 'collection') || chr(31) || (src ->> 'file_name')) = ANY(${pgTextArray(refs)}::text[])
                   OR ((src ->> 'collection') IS NULL AND (src ->> 'file_name') = ANY(${pgTextArray(names)}::text[]))
              )
            )
          ORDER BY m.id
          LIMIT ${PAGE}
        `)
      )
    )
    for (const row of rows) found.push({ messageId: String(row.id), conversationId: String(row.conversation_id) })
    if (rows.length < PAGE) return found
    afterId = String(rows[rows.length - 1].id)
  }
}

function pgTextArray(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return `{${quoted.join(',')}}`
}

export async function markAnswersSourceDeleted(
  organizationId: string,
  messageIds: readonly string[],
  rootFolderId: string,
  at: Date
): Promise<void> {
  if (messageIds.length === 0) return
  const db = getDb()
  const stamp = JSON.stringify({ sourceDeleted: { folderId: rootFolderId, at: at.toISOString() } })
  for (let start = 0; start < messageIds.length; start += PAGE) {
    const chunk = messageIds.slice(start, start + PAGE)
    await withTenant({ organizationId }, () =>
      db
        .update(messages)
        .set({ metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${stamp}::jsonb` })
        .where(
          and(
            eq(messages.organizationId, organizationId),
            inArray(messages.id, chunk),
            sql`${messages.metadata} -> 'sourceDeleted' IS NULL`
          )
        )
    )
  }
}

export async function replaceRemovedAnswers(
  organizationId: string,
  messageIds: readonly string[],
  rootFolderId: string,
  at: Date
): Promise<number> {
  if (messageIds.length === 0) return 0
  const db = getDb()
  const mark = JSON.stringify({ sourceRemoved: { folderId: rootFolderId, at: at.toISOString() } })
  let replaced = 0
  for (let start = 0; start < messageIds.length; start += PAGE) {
    const chunk = messageIds.slice(start, start + PAGE)
    const rows = await withTenant({ organizationId }, () =>
      db
        .update(messages)
        .set({ content: REMOVED_ANSWER_TEXT, metadata: sql`${mark}::jsonb` })
        .where(and(eq(messages.organizationId, organizationId), inArray(messages.id, chunk)))
        .returning({ id: messages.id })
    )
    replaced += rows.length
  }
  return replaced
}

export async function deleteMemoryDrawnFrom(
  organizationId: string,
  projectId: string,
  folderIds: readonly string[],
  conversationIds: readonly string[]
): Promise<string[]> {
  const db = getDb()
  const fromFolders = sql`${projectMemory.restrictedFolderIds} && ${`{${folderIds.join(',')}}`}::uuid[]`
  const fromConversations =
    conversationIds.length > 0 ? [inArray(projectMemory.sourceConversationId, [...conversationIds])] : []
  const rows = await withTenant({ organizationId }, () =>
    db
      .delete(projectMemory)
      .where(
        and(
          eq(projectMemory.organizationId, organizationId),
          or(eq(projectMemory.projectId, projectId), sql`${projectMemory.projectId} IS NULL`),
          or(fromFolders, ...fromConversations)
        )
      )
      .returning({ id: projectMemory.id })
  )
  return rows.map((row) => row.id)
}

export interface DerivedReport {
  id: string
  name: string
  projectId: string | null
}

export const REPORT_REVIEW_LIMIT = 500

export async function listReportsDerivedFrom(
  organizationId: string,
  conversationIds: readonly string[],
  messageIds: readonly string[]
): Promise<DerivedReport[]> {
  if (conversationIds.length === 0 && messageIds.length === 0) return []
  const db = getDb()
  const byVersion =
    conversationIds.length > 0
      ? [
          inArray(
            documents.id,
            db
              .select({ id: documentVersions.documentId })
              .from(documentVersions)
              .where(
                and(
                  eq(documentVersions.organizationId, organizationId),
                  inArray(documentVersions.originConversationId, [...conversationIds])
                )
              )
          ),
        ]
      : []
  const byAnswer = messageIds.length > 0 ? [inArray(documents.authoredByRef, [...messageIds])] : []
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: documents.id, filename: documents.filename, displayName: documents.displayName, projectId: documents.projectId })
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), ne(documents.authoredBy, 'user'), or(...byVersion, ...byAnswer)))
      .limit(REPORT_REVIEW_LIMIT)
  )
  return rows.map((row) => ({ id: row.id, name: row.displayName ?? row.filename, projectId: row.projectId }))
}

export async function markReportsSourceDeleted(
  organizationId: string,
  documentIds: readonly string[],
  rootFolderId: string,
  at: Date
): Promise<void> {
  if (documentIds.length === 0) return
  const db = getDb()
  const stamp = JSON.stringify({ sourceDeleted: { folderId: rootFolderId, at: at.toISOString() } })
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) || ${stamp}::jsonb` })
      .where(
        and(
          eq(documents.organizationId, organizationId),
          inArray(documents.id, [...documentIds]),
          sql`coalesce(${documents.metadata}, '{}'::jsonb) -> 'sourceDeleted' IS NULL`
        )
      )
  )
}
