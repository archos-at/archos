import 'server-only'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { mayWriteDocument } from '@/lib/documents/may-open'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import type { AnnotationRecord } from './repository'
import type { AnnotationAuthor, AnnotationDeleteRefusal } from './types'
import { AGENT_KIND, isAgentKind } from '@/lib/agent-kind'

export interface AnnotationActor {
  kind: AnnotationAuthor
  peerId?: string | null
}

export const PERSON: AnnotationActor = { kind: 'person' }
export const AGENT: AnnotationActor = { kind: AGENT_KIND }

export const mayDeleteMark = (record: Pick<AnnotationRecord, 'authorKind' | 'createdBy' | 'acceptedBy'>, userId: string) =>
  record.createdBy === userId && (record.authorKind === 'person' || record.acceptedBy === userId)

export function deleteRefusalOf(
  record: Pick<AnnotationRecord, 'createdBy' | 'replies' | 'carriedFromId' | 'carriedFrom' | 'carriedTo'>
): AnnotationDeleteRefusal | null {
  if (record.carriedFromId || record.carriedFrom || record.carriedTo) return 'carried'
  const othersWrote = record.replies.some((reply) => !isAgentKind(reply.authorKind) && reply.createdBy !== record.createdBy)
  return othersWrote ? 'discussed' : null
}

export const annotatable = (doc: Document) => doc.scope === 'project' || doc.scope === 'office_shelf'

export async function isAssignable(session: AuthorizedSession, doc: Document, userId: string): Promise<boolean> {
  return (await mayWriteDocument(session, doc, [userId])).has(userId)
}

export async function requireAssignable(session: AuthorizedSession, doc: Document, userId: string): Promise<void> {
  if (await isAssignable(session, doc, userId)) return
  throw new UnprocessableError('The assignee cannot answer Anmerkungen on this document.', {
    field: 'assigneeUserId',
    reason: 'assignee-cannot-answer',
  })
}

const MAX_ASSIGNEE_CANDIDATES = 10

const nameKey = (value: string | null | undefined) =>
  (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

export async function resolveAssignee(session: AuthorizedSession, doc: Document, query: string): Promise<string> {
  const key = nameKey(query)
  const people = [...(await loadOrganizationDirectory(session.organizationId)).values()]
  const exact = people.filter(
    (person) => person.userId === query.trim() || nameKey(person.name) === key || nameKey(person.email) === key
  )
  const loose = people.filter((person) => {
    const name = nameKey(person.name)
    return name.startsWith(key) || name.split(' ').includes(key)
  })
  const candidates = (exact.length > 0 ? exact : loose).slice(0, MAX_ASSIGNEE_CANDIDATES)
  const mayAnswer = await mayWriteDocument(session, doc, candidates.map((person) => person.userId))
  const reachable = candidates.filter((person) => mayAnswer.has(person.userId))
  if (reachable.length === 1) return reachable[0].userId
  if (reachable.length === 0) {
    throw new UnprocessableError(`Nobody called „${query.trim()}" can answer Anmerkungen on this document.`, {
      field: 'assignee',
      reason: 'assignee-unknown',
    })
  }
  const named = reachable.map((person) => (person.email ? `${person.name} (${person.email})` : person.name))
  throw new UnprocessableError(`„${query.trim()}" could be ${named.join(', ')}.`, {
    field: 'assignee',
    reason: 'assignee-ambiguous',
  })
}

export async function requireWritableDocument(session: AuthorizedSession, documentId: string): Promise<Document> {
  const doc = await getAccessibleDocument(session, documentId, 'write')
  if (!annotatable(doc)) throw new BadRequestError('This document cannot carry Anmerkungen.')
  return doc
}
