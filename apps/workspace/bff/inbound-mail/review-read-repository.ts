import 'server-only'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailPartRow, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { mailThreads } from '@/lib/db/schema/mail-thread'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { documentDisplayName } from '@/lib/documents/display-name'
import { CURSOR_TIMESTAMP_FORMAT } from '@/lib/documents/list-cursor'
import { documentVisibleTo, internalRead, SCREENED_ONLY } from '@/lib/documents/visibility'

export const OPEN_PART_STATES = ['waiting', 'filing'] as const

const partInState = (states: readonly string[]) =>
  sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id}
      AND p.state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)}))`

export interface MailListPosition {
  receivedAt: string
  id: string
}

export interface MailListRow {
  mail: InboundMailRow
  position: MailListPosition
}

export async function listProjectMails(
  projectId: string,
  query: { status: 'waiting' | 'handled'; outcome?: 'filed' | 'dismissed' | 'expired'; limit: number },
  after: MailListPosition | null,
): Promise<MailListRow[]> {
  const facet =
    query.status === 'waiting'
      ? and(eq(inboundMails.status, 'waiting'), partInState(OPEN_PART_STATES))
      : and(
          inArray(inboundMails.status, ['waiting', 'settled']),
          sql`NOT ${partInState(OPEN_PART_STATES)}`,
          query.outcome ? partInState([query.outcome]) : undefined,
        )
  const position = after
    ? sql`(${inboundMails.receivedAt} < (${after.receivedAt})::timestamp AT TIME ZONE 'UTC'
         OR (${inboundMails.receivedAt} = (${after.receivedAt})::timestamp AT TIME ZONE 'UTC' AND ${inboundMails.id} > ${after.id}))`
    : undefined
  const rows = await getDb()
    .select({
      mail: inboundMails,
      receivedAtText: sql<string>`to_char(${inboundMails.receivedAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
    })
    .from(inboundMails)
    .where(and(eq(inboundMails.projectId, projectId), facet, position))
    .orderBy(desc(inboundMails.receivedAt), inboundMails.id)
    .limit(query.limit + 1)
  return rows.map((row) => ({ mail: row.mail, position: { receivedAt: String(row.receivedAtText), id: row.mail.id } }))
}

export async function countWaitingMailsByProject(projectIds: readonly string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ projectId: inboundMails.projectId, count: sql<string>`count(*)` })
    .from(inboundMails)
    .where(and(inArray(inboundMails.projectId, [...projectIds]), eq(inboundMails.status, 'waiting'), partInState(OPEN_PART_STATES)))
    .groupBy(inboundMails.projectId)
    .limit(projectIds.length)
  return new Map(rows.map((row) => [row.projectId, Number(row.count)]))
}

export async function findProjectMail(projectId: string, mailId: string, executor: DbExecutor = getDb()): Promise<InboundMailRow | null> {
  const [row] = await executor
    .select()
    .from(inboundMails)
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.projectId, projectId), inArray(inboundMails.status, ['waiting', 'settled'])))
    .limit(1)
  return row ?? null
}

export async function findMailParts(mailIds: readonly string[], executor: DbExecutor = getDb()): Promise<InboundMailPartRow[]> {
  if (mailIds.length === 0) return []
  return executor
    .select()
    .from(inboundMailParts)
    .where(inArray(inboundMailParts.mailId, [...mailIds]))
    .orderBy(inboundMailParts.mailId, inboundMailParts.position)
    .limit(mailIds.length * 101)
}

export async function findFollowDeciders(mailIds: readonly string[]): Promise<Map<string, string>> {
  if (mailIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ mailId: inboundMailDecisions.mailId, decidedBy: inboundMailDecisions.decidedBy })
    .from(inboundMailDecisions)
    .innerJoin(inboundMailParts, eq(inboundMailParts.decisionId, inboundMailDecisions.id))
    .where(
      and(
        inArray(inboundMailDecisions.mailId, [...mailIds]),
        eq(inboundMailDecisions.via, 'follow'),
        eq(inboundMailParts.kind, 'message'),
        eq(inboundMailParts.state, 'filed'),
      ),
    )
    .limit(mailIds.length)
  return new Map(rows.map((row) => [row.mailId, row.decidedBy]))
}

export interface ThreadDocument {
  threadId: string
  documentId: string
  name: string
  folderId: string | null
  folderPath: string | null
  nextVersion: number
  entryCount: number
  renderedBytes: number
  participantDomains: string[]
}

export async function findThreadDocuments(projectId: string, threadIds: readonly string[]): Promise<ThreadDocument[]> {
  const ids = [...new Set(threadIds)].slice(0, 100)
  if (ids.length === 0) return []
  const rows = await getDb()
    .select({
      threadId: mailThreads.id,
      documentId: documents.id,
      filename: documents.filename,
      displayName: documents.displayName,
      folderId: documents.folderId,
      folderPath: projectFolders.path,
      nextVersion: sql<string>`(SELECT coalesce(max(v.version_number), 0) + 1 FROM document_versions v WHERE v.document_id = ${documents.id})`,
      entryCount: mailThreads.entryCount,
      renderedBytes: mailThreads.renderedBytes,
      participantDomains: mailThreads.participantDomains,
    })
    .from(mailThreads)
    .innerJoin(documents, and(eq(documents.id, mailThreads.documentId), eq(documents.projectId, mailThreads.projectId)))
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        eq(mailThreads.projectId, projectId),
        inArray(mailThreads.id, ids),
        documentVisibleTo(SCREENED_ONLY),
        or(isNull(documents.folderId), isNull(projectFolders.deletedAt)),
      ),
    )
    .limit(ids.length)
  return rows.map((row) => ({
    threadId: row.threadId,
    documentId: row.documentId,
    name: documentDisplayName({ filename: row.filename, displayName: row.displayName }),
    folderId: row.folderId,
    folderPath: row.folderPath ?? null,
    nextVersion: Number(row.nextVersion),
    entryCount: row.entryCount,
    renderedBytes: row.renderedBytes,
    participantDomains: row.participantDomains,
  }))
}

export interface CandidateDocument {
  documentId: string
  name: string
  folderId: string | null
  folderPath: string | null
  nextVersion: number
}

export async function findCandidateDocuments(projectId: string, documentIds: readonly string[]): Promise<CandidateDocument[]> {
  const ids = [...new Set(documentIds)].slice(0, 200)
  if (ids.length === 0) return []
  const rows = await getDb()
    .select({
      documentId: documents.id,
      filename: documents.filename,
      displayName: documents.displayName,
      folderId: documents.folderId,
      folderPath: projectFolders.path,
      nextVersion: sql<string>`(SELECT coalesce(max(v.version_number), 0) + 1 FROM document_versions v WHERE v.document_id = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        eq(documents.projectId, projectId),
        inArray(documents.id, ids),
        documentVisibleTo(SCREENED_ONLY),
        or(isNull(documents.folderId), isNull(projectFolders.deletedAt)),
      ),
    )
    .limit(ids.length)
  return rows.map((row) => ({
    documentId: row.documentId,
    name: documentDisplayName({ filename: row.filename, displayName: row.displayName }),
    folderId: row.folderId,
    folderPath: row.folderPath ?? null,
    nextVersion: Number(row.nextVersion),
  }))
}

export async function findVersionNumbers(projectId: string, versionIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(versionIds)].slice(0, 200)
  if (ids.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
    .from(documentVersions)
    .innerJoin(documents, and(eq(documents.id, documentVersions.documentId), eq(documents.projectId, projectId)))
    .where(and(inArray(documentVersions.id, ids), documentVisibleTo(SCREENED_ONLY)))
    .limit(ids.length)
  return new Map(rows.map((row) => [row.id, Number(row.versionNumber)]))
}

export async function findDocumentIdByStoredName(projectId: string, storedName: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.filename, storedName), documentVisibleTo(internalRead('identity'))))
    .limit(1)
  return row?.id ?? null
}

export async function findLiveFolders(projectId: string, folderIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(folderIds)].slice(0, 200)
  if (ids.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: projectFolders.id, path: projectFolders.path })
    .from(projectFolders)
    .where(
      and(
        eq(projectFolders.projectId, projectId),
        eq(projectFolders.scope, 'project'),
        inArray(projectFolders.id, ids),
        isNull(projectFolders.deletedAt),
      ),
    )
    .limit(ids.length)
  return new Map(rows.map((row) => [row.id, row.path]))
}
