/**
 * SQL the review service reads (ADR-0137): the E-Mail-Eingang's lists, a mail
 * and its parts, and the documents, versions and folders a decision names.
 *
 * No authorization here: the service decides who may ask, and row-level
 * security is the backstop. Every list is bounded. The rules a row must keep
 * are CHECKs in the migration (`./repository.ts`).
 */

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

/** The part states a person still has to decide, or the filing job is working on. */
export const OPEN_PART_STATES = ['waiting', 'filing'] as const

const partInState = (states: readonly string[]) =>
  sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id}
      AND p.state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)}))`

/** A position in the list's `received_at DESC, id ASC` order (`lib/documents/list-cursor.ts` encodes it). */
export interface MailListPosition {
  /** `received_at` as `to_char(… 'US')` wrote it, UTC, microseconds. */
  receivedAt: string
  id: string
}

/** One mail of a list page: the row, its part counts, and its position for the next cursor. */
export interface MailListRow {
  mail: InboundMailRow
  position: MailListPosition
}

/**
 * One page of a project's E-Mail-Eingang, newest first. `waiting`: mail with a
 * part a person still has to decide or that is being filed. `handled`: mail
 * where nothing is open any more, settled or within the seven days its
 * dismissed or expired parts can be restored; `outcome` narrows it to mail
 * with a part filed, dismissed or expired. Receiving and dropped mail is never
 * listed. Reads one row more than `limit`, so the caller knows a page follows.
 */
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

/**
 * How many mails wait in each of these projects' E-Mail-Eingang: held, with a
 * part waiting for a person or being filed, the waiting list's own facet. Mail
 * is the project's, not a reader's, so the caller decides whose projects to ask
 * about (`waitingMailCounts`). Projects with none are absent.
 */
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

/** A held or settled mail of the project, or null (receiving and dropped mail is nobody's to read). */
export async function findProjectMail(projectId: string, mailId: string, executor: DbExecutor = getDb()): Promise<InboundMailRow | null> {
  const [row] = await executor
    .select()
    .from(inboundMails)
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.projectId, projectId), inArray(inboundMails.status, ['waiting', 'settled'])))
    .limit(1)
  return row ?? null
}

/** The parts of these mails, in mail and position order (at most 101 per mail). */
export async function findMailParts(mailIds: readonly string[], executor: DbExecutor = getDb()): Promise<InboundMailPartRow[]> {
  if (mailIds.length === 0) return []
  return executor
    .select()
    .from(inboundMailParts)
    .where(inArray(inboundMailParts.mailId, [...mailIds]))
    .orderBy(inboundMailParts.mailId, inboundMailParts.position)
    .limit(mailIds.length * 101)
}

/**
 * Whose follow appended a mail's text (D31), per mail; mails no follow
 * appended are absent. Read from the decision the filed text part carries, so
 * it agrees with the follow job by construction: the job decides only as the
 * earliest follow running (not ended, not run out) and made before the mail
 * arrived (`earliestActiveFollow`), and `writeFollowDecision` re-checks that
 * under the follow's row lock, as that follow's person. A follow
 * decision whose filing has not finished, or whose claim lapsed and handed the
 * text back to a person, names nobody: the text was not appended.
 */
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

/** A thread of the project with its live document, as a candidate is shown (D9, D11). */
export interface ThreadDocument {
  threadId: string
  documentId: string
  name: string
  folderId: string | null
  folderPath: string | null
  nextVersion: number
  entryCount: number
  renderedBytes: number
}

/**
 * These threads of the project whose document has passed its screening and is
 * not in the bin, with the document's name, folder and next Fassung. A thread
 * whose document is held, gone or binned is no candidate for anyone. Whether
 * the VIEWER may read the folder is the caller's question (`candidates.ts`).
 */
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
      // The next Fassung's number, read beside the document this query lets through.
      nextVersion: sql<string>`(SELECT coalesce(max(v.version_number), 0) + 1 FROM document_versions v WHERE v.document_id = ${documents.id})`,
      entryCount: mailThreads.entryCount,
      renderedBytes: mailThreads.renderedBytes,
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
  }))
}

/** A document of the project a part matched, as a candidate is shown. */
export interface CandidateDocument {
  documentId: string
  name: string
  folderId: string | null
  folderPath: string | null
  nextVersion: number
}

/**
 * These documents of the project, screened and not in the bin: the documents
 * the parts' stored ids name (`duplicate_of`, `revision_candidate`). Whether
 * the viewer may read each folder is the caller's question.
 */
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

/**
 * The Fassung each of these document versions is, by version id: what a filed
 * part became (`filedAs` on the part's view). Only versions of the project's
 * screened documents not in the bin, like {@link findCandidateDocuments};
 * whether the viewer may read the folder is the caller's question.
 */
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

/**
 * The document of the project already stored under this name (its stored,
 * composed form, `documentNameKey`), held ones included: a name is taken by
 * every row, which a unique index answers for all of them (`identity`). A
 * filing under a taken name would silently become that document's next
 * Fassung, so the decision asks for `revisionOf` instead (C2).
 */
export async function findDocumentIdByStoredName(projectId: string, storedName: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.filename, storedName), documentVisibleTo(internalRead('identity'))))
    .limit(1)
  return row?.id ?? null
}

/** The project's live folders among these ids, each with its path. */
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
