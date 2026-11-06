/**
 * The office's base knowledge (ADR-0158, ticket 32): which Archiv documents are
 * licensed standards, commentaries, authority directives, guidelines or laws,
 * in which edition, where they apply, under which licence, and when they were
 * last checked. The headless capability; the routes, the agent operations and
 * the settings card are its clients.
 *
 * - A proposal records the values the reading (or an agent) suggests; nothing
 *   reaches an answer until a person confirms. Confirmation moves the heads and
 *   counts as the first check.
 * - An edit appends revisions; history is never rewritten (migration 0200).
 * - A check records what somebody found; the freshness marker reads the newest.
 * - Removal deletes the Archiv document through the Archiv's own delete (chunks,
 *   objects, holds), and the records go with it by foreign key.
 *
 * Reads are any member's, as the Archiv's are; writes take
 * `org:office_shelf:manage`, as uploading to the Archiv does. The revisions and
 * checks carry who and when, so they are the trail; the removal is audited by
 * the Archiv delete it runs.
 */

import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/authz/feature-flags'
import { deleteOfficeShelfDocument } from '@/lib/office-shelf/service'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import type { KnowledgeProvenance } from '@/lib/db/schema/knowledge-records'
import {
  documentHasEntry,
  insertCopyCheck,
  insertProposedEntry,
  readOfficeEntries,
  writeConfirmedValues,
  type StoredEntry,
} from '../store/repository'
import {
  ENTRY_PAGE,
  type BaseKnowledgeEntry,
  type BaseKnowledgeList,
  type ConfirmEntryBody,
  type EntryValues,
  type ListEntriesQuery,
  type ProposeEntryBody,
  type RecordCheckBody,
} from '../wire'
import { projectTerritory } from './authority'
import { freshnessOf } from './freshness'
import { markCopyPoints } from './mark'
import { proposeFromReading } from './reading'
import { readDocumentReading, visibleOfficeDocuments, type EntryDocument } from './repository'
import { renderBaseKnowledgeBlock } from './turn-block'

/** Thrown when the organization does not have base knowledge switched on. */
export class BaseKnowledgeDisabledError extends ForbiddenError {
  constructor() {
    super('Base knowledge is not enabled for this organization.')
  }
}

function requireEnabled(session: AuthorizedSession): void {
  if (!isFeatureEnabled(session, FEATURE_FLAGS.officeBaseKnowledge)) throw new BaseKnowledgeDisabledError()
}

function requireManage(session: AuthorizedSession): void {
  requireEnabled(session)
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

const reader = (session: AuthorizedSession) => shelfReaderFor(session, { scope: 'office_shelf', projectId: null })

function toEntry(stored: StoredEntry, document: EntryDocument, now: Date): BaseKnowledgeEntry {
  return {
    id: stored.workId,
    editionId: stored.editionId,
    copyId: stored.copyId,
    documentId: stored.documentId,
    fileName: document.fileName,
    status: stored.confirmed ? 'confirmed' : 'proposed',
    values: stored.values,
    proposedBy: stored.provenance.proposedBy ?? 'reading',
    freshness: freshnessOf(stored.values.kind, stored.confirmed ? stored.lastCheck : null, now),
    createdAt: stored.createdAt.toISOString(),
  }
}

function matches(entry: BaseKnowledgeEntry, query: Partial<ListEntriesQuery>): boolean {
  if (query.status && entry.status !== query.status) return false
  if (!query.designation) return true
  const wanted = query.designation.toLocaleLowerCase('de')
  return (entry.values.designation ?? entry.values.title).toLocaleLowerCase('de').includes(wanted)
}

/** The office's entries the session may see, newest first. */
export async function listBaseKnowledge(
  session: AuthorizedSession,
  query: Partial<ListEntriesQuery> = {}
): Promise<BaseKnowledgeList> {
  const enabled = isFeatureEnabled(session, FEATURE_FLAGS.officeBaseKnowledge)
  const canManage = enabled && canManageOfficeShelf(session)
  if (!enabled) return { enabled, canManage, entries: [], nextCursor: null }
  const stored = await readOfficeEntries(session.organizationId)
  const documents = await visibleOfficeDocuments(
    session.organizationId,
    stored.map((entry) => entry.documentId),
    await reader(session)
  )
  const now = new Date()
  const entries = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now)] : []
  })
  const matching = entries.filter((entry) => matches(entry, query))
  const start = query.cursor ? Number(query.cursor) : 0
  const end = start + (query.limit ?? ENTRY_PAGE)
  return { enabled, canManage, entries: matching.slice(start, end), nextCursor: end < matching.length ? String(end) : null }
}

async function findEntry(
  session: AuthorizedSession,
  entryId: string
): Promise<{ stored: StoredEntry; entry: BaseKnowledgeEntry; document: EntryDocument }> {
  const stored = (await readOfficeEntries(session.organizationId)).find((entry) => entry.workId === entryId)
  if (!stored) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
  const documents = await visibleOfficeDocuments(session.organizationId, [stored.documentId], await reader(session))
  const document = documents.get(stored.documentId)
  if (!document) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
  return { stored, entry: toEntry(stored, document, new Date()), document }
}

export async function getBaseKnowledgeEntry(session: AuthorizedSession, entryId: string): Promise<BaseKnowledgeEntry> {
  requireEnabled(session)
  return (await findEntry(session, entryId)).entry
}

/** The given values over the base, field by field; `undefined` keeps the base's. */
function merged(base: EntryValues, given: Partial<EntryValues>): EntryValues {
  const defined = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined))
  const values = { ...base, ...defined } as EntryValues
  // Only a directive addresses an authority.
  return values.kind === 'authority_directive' ? values : { ...values, addressees: [] }
}

function valuesOf(body: ProposeEntryBody | ConfirmEntryBody): Partial<EntryValues> {
  const { kind, title, designation, editionLabel, issuedOn, territoryIds, issuer, addressees, licenceClass } = body
  return { kind, title, designation, editionLabel, issuedOn, territoryIds, issuer, addressees, licenceClass }
}

/**
 * Propose an entry for one Archiv document: the reading's values, any given
 * values over them. `proposedBy` says whose they are; an agent's call through
 * the door is `agent`. One entry per document.
 */
export async function proposeBaseKnowledge(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  proposedBy: KnowledgeProvenance['proposedBy'] = 'reading'
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const reading = await readDocumentReading(session.organizationId, body.documentId, await reader(session))
  if (!reading) throw new NotFoundError('No Archiv document with this id; list the Archiv first.')
  if (await documentHasEntry(session.organizationId, body.documentId)) {
    throw new ConflictError('This document is already recorded as base knowledge; edit that entry instead.')
  }
  const given = valuesOf(body)
  const values = merged(proposeFromReading(reading), given)
  const source = Object.values(given).some((value) => value !== undefined) ? proposedBy : 'reading'
  const ids = await insertProposedEntry(body.documentId, values, {
    organizationId: session.organizationId,
    createdBy: session.userId,
    provenance: { proposedBy: source },
  })
  return (await findEntry(session, ids.workId)).entry
}

function requireAttestation(values: EntryValues, body: ConfirmEntryBody): void {
  if (values.licenceClass === 'licensed' && body.licenceAttested !== true) {
    throw new UnprocessableError(
      'A licensed copy needs licenceAttested: true, the office’s statement that its licence covers use by everyone in the office.'
    )
  }
}

async function writeValues(
  session: AuthorizedSession,
  { stored, document }: { stored: StoredEntry; document: EntryDocument },
  values: EntryValues,
  firstCheck: boolean
): Promise<void> {
  await writeConfirmedValues(stored, values, {
    organizationId: session.organizationId,
    createdBy: session.userId,
    provenance: { proposedBy: 'person' },
    firstCheck,
  })
  await markCopyPoints(document, stored.editionId, values.licenceClass)
}

/** Confirm a proposed entry, with any corrections; it reaches answers from now on. */
export async function confirmBaseKnowledge(
  session: AuthorizedSession,
  entryId: string,
  body: ConfirmEntryBody
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const found = await findEntry(session, entryId)
  if (found.stored.confirmed) throw new ConflictError('This entry is already confirmed; edit it instead.')
  const values = merged(found.stored.values, valuesOf(body))
  requireAttestation(values, body)
  await writeValues(session, found, values, true)
  return (await findEntry(session, entryId)).entry
}

/** Change a confirmed entry's values: one new revision per record, the heads moved. */
export async function updateBaseKnowledge(
  session: AuthorizedSession,
  entryId: string,
  body: ConfirmEntryBody
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const found = await findEntry(session, entryId)
  if (!found.stored.confirmed) throw new ConflictError('This entry is still a proposal; confirm it instead.')
  const values = merged(found.stored.values, valuesOf(body))
  if (values.licenceClass === 'licensed' && found.stored.values.licenceClass !== 'licensed') requireAttestation(values, body)
  await writeValues(session, found, values, false)
  return (await findEntry(session, entryId)).entry
}

/** Record that somebody checked the copy is still the edition in force, and what they found. */
export async function recordBaseKnowledgeCheck(
  session: AuthorizedSession,
  entryId: string,
  body: RecordCheckBody
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const { stored } = await findEntry(session, entryId)
  if (!stored.confirmed) throw new ConflictError('Confirm the entry before recording a check.')
  await insertCopyCheck(session.organizationId, stored.copyId, {
    checkedBy: session.userId,
    result: body.result,
    note: body.note ?? null,
  })
  return (await findEntry(session, entryId)).entry
}

/**
 * Remove an entry and its document: the Archiv's own delete (holds, chunks,
 * objects), after which the records, revisions and checks are gone by cascade.
 */
export async function removeBaseKnowledge(session: AuthorizedSession, entryId: string, request: Request): Promise<void> {
  requireManage(session)
  const { stored } = await findEntry(session, entryId)
  await deleteOfficeShelfDocument(session, stored.documentId, request)
}

/**
 * The block a turn carries (`turn-context/service.ts`), or null: when the flag
 * is off for the organization or it holds no confirmed entry. Read as the model
 * reads (`SCREENED_ONLY`), so a held upload stays out of the turn.
 */
export async function baseKnowledgeForTurn(organizationId: string, projectId: string | null): Promise<string | null> {
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.officeBaseKnowledge, organizationId))) return null
  const stored = (await readOfficeEntries(organizationId)).filter((entry) => entry.confirmed)
  if (stored.length === 0) return null
  const [documents, profile] = await Promise.all([
    visibleOfficeDocuments(organizationId, stored.map((entry) => entry.documentId), SCREENED_ONLY),
    projectId ? findProjectProfileInOrg(projectId, organizationId) : Promise.resolve(null),
  ])
  const facts = profile?.profile?.facts ?? {}
  const territory = projectTerritory({ federalState: facts.federal_state?.value, country: facts.country?.value })
  const now = new Date()
  const entries = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now)] : []
  })
  return renderBaseKnowledgeBlock(entries, territory)
}
