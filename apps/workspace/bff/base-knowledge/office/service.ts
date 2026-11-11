/**
 * The office's base knowledge (ADR-0163, ticket 32): which Archiv documents are
 * licensed standards, commentaries, authority directives, guidelines or laws,
 * in which edition, where they apply, under which licence, and when they were
 * last checked. The headless capability; the routes, the agent operations and
 * the settings card are its clients.
 *
 * - A proposal records the values the reading (or an agent) suggests; nothing
 *   reaches an answer until a person confirms. Confirmation moves the heads and
 *   counts as the first check.
 * - An edit appends revisions; history is never rewritten (migration 0202).
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
import { deleteOfficeShelfDocument, uploadOfficeShelfDocument, type OfficeShelfRemoval } from '@/lib/office-shelf/service'
import { forgetKeysFor } from '../http/idempotency'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
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
  type LicenceEntryBody,
  type UpdateEntryBody,
  type ListEntriesQuery,
  type ProposeEntryBody,
  type RecordCheckBody,
} from '../wire'
import { readSetupRecords } from '@/lib/project-intake/setup-records'
import { subdivisionTerritories } from '@/lib/project-intake/setup-scope'
import { projectTerritory } from './authority'
import { freshnessOf } from './freshness'
import { markCopyPoints } from './mark'
import { proposeFromReading } from './reading'
import { readShelfDocument, shelfNameHasEntry, visibleOfficeDocuments, type EntryDocument } from './repository'
import { documentNameKey } from '@/lib/documents/name-match'
import { releaseText, withholdText } from './text-effects'
import { licenceMarkOf, termsAfter, textUseOf } from './text-use'
import { renderBaseKnowledgeBlock } from './turn-block'
import { officeAnswerLabel, type OfficeAnswerLabel } from './answer-label'
import { platformKnowledge } from '../platform'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { territoryChoices } from './territory-choices'
import { isStandardsFolder, standardsFolderRows, standardsRoot } from './folders'
import { editionOnDay, editionsByWork, editionsOf, workDesignation } from './work-editions'
import { referenceDayOfProfile } from '../time/profile-procedure'
import { insertEditionOfWork, deleteWorkIfUnused } from '../store/office-editions'
import { byAttention, countByFolder, countEntries, matchesQuery, subtreeOf } from './listing'


function requireManage(session: AuthorizedSession): void {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

const reader = (session: AuthorizedSession) => shelfReaderFor(session, { scope: 'office_shelf', projectId: null })

/** Display names by user id; empty when the directory cannot be read, which costs names and nothing else. */
type Names = ReadonlyMap<string, { name: string }>
const NO_NAMES: Names = new Map()

type Works = ReadonlyMap<string, StoredEntry[]>
const NO_WORKS: Works = new Map()
const dayOf = (now: Date) => now.toISOString().slice(0, 10)

function toEntry(stored: StoredEntry, document: EntryDocument, now: Date, names: Names = NO_NAMES, works: Works = NO_WORKS): BaseKnowledgeEntry {
  const confirmedBy = stored.confirmed ? (stored.provenance.confirmedBy ?? null) : null
  return {
    // An entry is one edition: a standard's editions share their work (`store/office-editions.ts`).
    id: stored.editionId,
    workId: stored.workId,
    editionId: stored.editionId,
    copyId: stored.copyId,
    documentId: stored.documentId,
    fileName: document.fileName,
    status: stored.confirmed ? 'confirmed' : 'proposed',
    values: stored.values,
    proposedBy: stored.provenance.proposedBy ?? 'reading',
    confirmedBy,
    confirmedByName: confirmedBy ? (names.get(confirmedBy)?.name ?? null) : null,
    textUse: textUseOf(stored.values.licenceClass, stored.terms),
    aiProcessingAttestedAt: stored.terms.aiProcessingAttestedAt ?? null,
    freshness: freshnessOf(stored.values.kind, stored.confirmed ? stored.lastCheck : null, now),
    folderId: document.folderId,
    editions: editionsOf(stored, works, dayOf(now)),
    createdAt: stored.createdAt.toISOString(),
  }
}

/**
 * The office's entries the session may see: in the folder asked for (with its
 * subfolders), counted before the other filters narrow them, and those the
 * filters keep in the order a person works through them (`listing.ts`).
 */
export async function listBaseKnowledge(
  session: AuthorizedSession,
  query: Partial<ListEntriesQuery> = {}
): Promise<BaseKnowledgeList> {
  const canManage = canManageOfficeShelf(session)
  const stored = await readOfficeEntries(session.organizationId)
  const [documents, names, folders, territories] = await Promise.all([
    visibleOfficeDocuments(session.organizationId, stored.map((entry) => entry.documentId), await reader(session)),
    loadOrganizationDirectory(session.organizationId),
    query.folderId ? standardsFolderRows(session) : null,
    territoryChoices(session.organizationId).catch(() => []),
  ])
  const inFolder = folders && query.folderId ? subtreeOf(query.folderId, [...(folders.root ? [folders.root] : []), ...folders.folders]) : null
  const now = new Date()
  // An edition the reader may not see (an upload still in screening, ADR-0086) adds nothing to another's history.
  const works = editionsByWork(stored.filter((entry) => documents.has(entry.documentId)))
  const visible = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now, names, works)] : []
  })
  const entries = inFolder ? visible.filter((entry) => entry.folderId !== null && inFolder.has(entry.folderId)) : visible
  const matching = entries.filter((entry) => matchesQuery(entry, query)).sort(byAttention)
  const start = query.cursor ? Number(query.cursor) : 0
  const end = start + (query.limit ?? ENTRY_PAGE)
  return {
    canManage,
    counts: countEntries(entries),
    territories,
    folderCounts: countByFolder(visible),
    entries: matching.slice(start, end),
    nextCursor: end < matching.length ? String(end) : null,
  }
}

async function findEntry(
  session: AuthorizedSession,
  entryId: string
): Promise<{ stored: StoredEntry; entry: BaseKnowledgeEntry; document: EntryDocument }> {
  const all = await readOfficeEntries(session.organizationId)
  // By its edition; an id from before editions shared a work is the work's, whose first edition it was.
  const stored = all.find((entry) => entry.editionId === entryId) ?? all.find((entry) => entry.workId === entryId && !entry.workStandsAlone)
  if (!stored) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
  const editions = all.filter((entry) => entry.workId === stored.workId)
  const [documents, names] = await Promise.all([
    visibleOfficeDocuments(session.organizationId, editions.map((entry) => entry.documentId), await reader(session)),
    loadOrganizationDirectory(session.organizationId),
  ])
  const document = documents.get(stored.documentId)
  if (!document) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
  const now = new Date()
  // Its history holds only the editions this reader may see (ADR-0086).
  const works = editionsByWork(editions.filter((entry) => documents.has(entry.documentId)))
  return { stored, entry: toEntry(stored, document, now, names, works), document }
}

/** The stored records of an entry the session may see, for a caller that builds on them (a newer edition). */
export async function storedEntryOf(session: AuthorizedSession, entryId: string): Promise<{ stored: StoredEntry; entry: BaseKnowledgeEntry }> {
  const { stored, entry } = await findEntry(session, entryId)
  return { stored, entry }
}

export async function getBaseKnowledgeEntry(session: AuthorizedSession, entryId: string): Promise<BaseKnowledgeEntry> {
  return (await findEntry(session, entryId)).entry
}

/** The given values over the base, field by field; `undefined` keeps the base's. */
function merged(base: EntryValues, given: Partial<EntryValues>): EntryValues {
  const defined = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined))
  const values = { ...base, ...defined } as EntryValues
  // An edition starts on its in-force date, else its issue date; an end on or before that leaves it in force on no day.
  const start = values.inForceFrom ?? values.issuedOn
  if (start && values.inForceTo && values.inForceTo <= start) {
    throw new UnprocessableError(`inForceTo (${values.inForceTo}) is not after the edition's start (${start}); an edition ends after it starts.`)
  }
  // Only a directive addresses an authority.
  return values.kind === 'authority_directive' ? values : { ...values, addressees: [] }
}

/** The entry values a body states; a body's other fields (its statements, its document) are not values. */
function valuesOf(body: Partial<EntryValues>): Partial<EntryValues> {
  const { kind, title, designation, editionLabel, issuedOn, inForceFrom, inForceTo, territoryIds, issuer, addressees, licenceClass } = body
  return { kind, title, designation, editionLabel, issuedOn, inForceFrom, inForceTo, territoryIds, issuer, addressees, licenceClass }
}

/** The values that are an edition's own: what changes from one edition of a standard to the next. */
function editionValues(values: EntryValues): Pick<EntryValues, 'editionLabel' | 'issuedOn' | 'inForceFrom' | 'inForceTo' | 'designation'> {
  const { editionLabel, issuedOn, inForceFrom, inForceTo, designation } = values
  return { editionLabel, issuedOn, inForceFrom, inForceTo, designation }
}

/**
 * Propose an entry for one Archiv document: what its file name says, any given
 * values over it. `proposedBy` says whose they are; an agent's call through the
 * door is `agent`. One entry per document. The proposal reads no text: a
 * summary the upload may have written is a reading of what may be a licensed
 * copy, and from now on the copy's text is held until a person confirms it
 * (its passages and search row go now; `text-guard.ts`).
 */
export async function proposeBaseKnowledge(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  proposedBy: KnowledgeProvenance['proposedBy'] = 'reading'
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const document = await readShelfDocument(session.organizationId, body.documentId, await reader(session))
  if (!document) throw new NotFoundError('No Archiv document with this id; list the Archiv first.')
  return proposeDocument(session, body, document.fileName, proposedBy)
}

async function proposeDocument(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  fileName: string,
  proposedBy: KnowledgeProvenance['proposedBy'],
  editionOf?: StoredEntry
): Promise<BaseKnowledgeEntry> {
  const entryId = await recordProposal(session, body, fileName, proposedBy, editionOf)
  await withholdText(session, body.documentId)
  return (await findEntry(session, entryId)).entry
}

/**
 * The proposed records for one document, from its file name and the given
 * values; the entry's id. With `editionOf`, a newer edition of that entry's
 * work: the work's values are kept, the edition is read from the file name.
 */
async function recordProposal(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  fileName: string,
  proposedBy: KnowledgeProvenance['proposedBy'],
  editionOf?: StoredEntry
): Promise<string> {
  if (await documentHasEntry(session.organizationId, body.documentId)) {
    throw new ConflictError('This document is already recorded as base knowledge; edit that entry instead.')
  }
  const given = valuesOf(body)
  const values = merged(proposeFromReading({ fileName }, subdivisionTerritories(await readSetupRecords(session.organizationId))), given)
  const source = Object.values(given).some((value) => value !== undefined) ? proposedBy : 'reading'
  const context = { organizationId: session.organizationId, createdBy: session.userId, provenance: { proposedBy: source }, terms: {} }
  const ids = editionOf
    ? await insertEditionOfWork(body.documentId, editionOf, { ...editionOf.values, ...editionValues(values), licenceClass: editionOf.values.licenceClass }, context)
    : await insertProposedEntry(body.documentId, values, context)
  return ids.editionId
}

/**
 * Upload a file to the office shelf as base knowledge: the proposal is recorded
 * before the dispatch, so the dispatch finds the copy held and reads nothing:
 * no embedding, no summary, no facets until a person confirms it public or
 * attested. A re-upload of bytes the shelf already holds proposes that document.
 * It lands in the standards folder asked for, or in the standards root
 * („Grundlagen des Büros“, created on first use).
 */
export async function uploadBaseKnowledge(
  session: AuthorizedSession,
  file: File,
  request: Request,
  { folderId = null, editionOf, ...given }: Omit<ProposeEntryBody, 'documentId'> & { folderId?: string | null; editionOf?: StoredEntry } = {}
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  // Before any bytes are written: an upload under an existing name replaces that
  // document's file in place, and a recorded copy's file is changed through its
  // entry (remove it, or record the new edition under another name), never here.
  if (await shelfNameHasEntry(session.organizationId, documentNameKey(file.name), await reader(session))) {
    throw new ConflictError('A document with this name is already recorded as base knowledge; remove that entry first, or upload the new edition under its own name.')
  }
  if (folderId && !(await isStandardsFolder(session, folderId))) {
    throw new UnprocessableError('folderId is not a base-knowledge folder; take one from base-knowledge-folder-list, or omit it.')
  }
  const target = folderId ?? (await standardsRoot(session.organizationId)).id
  let entryId: string | null = null
  const uploaded = await uploadOfficeShelfDocument(session, file, request, {
    folderId: target,
    beforeDispatch: async (documentId) => {
      entryId = await recordProposal(session, { ...given, documentId }, file.name, 'person', editionOf)
    },
  })
  if (entryId) return (await findEntry(session, entryId)).entry
  return proposeDocument(session, { ...given, documentId: uploaded.documentId }, file.name, 'person', editionOf)
}

function requireAttestation(values: EntryValues, body: ConfirmEntryBody): void {
  if (values.licenceClass === 'licensed' && body.licenceAttested !== true) {
    throw new UnprocessableError(
      'A licensed copy needs licenceAttested: true, the office’s statement that its licence covers use by everyone in the office.'
    )
  }
}

/**
 * A person's values as new revisions with the heads moved, then what the copy's
 * text use changed: withheld text leaves the index, allowed text is read again
 * (and marked by its job), text in use keeps its points' mark current.
 */
async function writeValues(
  session: AuthorizedSession,
  { stored, document }: { stored: StoredEntry; document: EntryDocument },
  values: EntryValues,
  body: ConfirmEntryBody,
  firstCheck: boolean
): Promise<void> {
  const terms = termsAfter(stored.terms, body, session.userId, new Date())
  // A work its editions share is cited without one edition's date; each edition's own is its label.
  const written = stored.workStandsAlone ? { ...values, designation: workDesignation(values.designation) } : values
  await writeConfirmedValues(stored, written, {
    organizationId: session.organizationId,
    createdBy: session.userId,
    provenance: { proposedBy: stored.provenance.proposedBy ?? 'reading', confirmedBy: session.userId },
    terms,
    firstCheck,
  })
  // A proposal's text is held whatever its class: confirming is what releases it.
  const before = stored.confirmed ? textUseOf(stored.values.licenceClass, stored.terms) : 'metadata_only'
  const after = textUseOf(values.licenceClass, terms)
  if (after === 'metadata_only') await withholdText(session, stored.documentId)
  else if (before === 'metadata_only') await releaseText(session, stored.documentId)
  else await markCopyPoints(document, stored.editionId, licenceMarkOf(values.licenceClass, terms))
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
  await writeValues(session, found, values, body, true)
  return (await findEntry(session, entryId)).entry
}

/** Change a confirmed entry's descriptive values: one new revision per record, the heads moved. */
export async function updateBaseKnowledge(
  session: AuthorizedSession,
  entryId: string,
  body: UpdateEntryBody
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const found = await findEntry(session, entryId)
  if (!found.stored.confirmed) throw new ConflictError('This entry is still a proposal; confirm it instead.')
  await writeValues(session, found, merged(found.stored.values, valuesOf(body)), {}, false)
  return (await findEntry(session, entryId)).entry
}

/**
 * Change a confirmed copy's licence: its class, or the office's statements on
 * it. Whether the text reaches a model turns on these, so this is the person's
 * call alone (`personDecides`, offered to no agent of the office's own).
 */
export async function setBaseKnowledgeLicence(
  session: AuthorizedSession,
  entryId: string,
  body: LicenceEntryBody
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const found = await findEntry(session, entryId)
  if (!found.stored.confirmed) throw new ConflictError('This entry is still a proposal; confirm it instead.')
  const values = merged(found.stored.values, valuesOf(body))
  if (values.licenceClass === 'licensed' && found.stored.values.licenceClass !== 'licensed') requireAttestation(values, body)
  await writeValues(session, found, values, body, false)
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
 * objects), after which the records, revisions and checks are gone by cascade,
 * and the kept answers to repeated writes about it are dropped. The receipt
 * says what each store reports; `removed` only when nothing is left.
 */
export async function removeBaseKnowledge(session: AuthorizedSession, entryId: string, request: Request): Promise<BaseKnowledgeRemoval> {
  requireManage(session)
  const { stored } = await findEntry(session, entryId)
  const stores = await deleteOfficeShelfDocument(session, stored.documentId, request)
  // The work goes with the last of its editions; while another edition names it, it stays.
  if (stored.workStandsAlone) await deleteWorkIfUnused(session.organizationId, stored.workId)
  const caches = (await forgetKeysFor(session.organizationId, [entryId, stored.documentId])) ? 'removed' : 'failed'
  return {
    removed: stores.search !== 'failed' && stores.objects === 'removed' && caches === 'removed',
    stores: { ...stores, records: 'removed', caches },
  }
}

/** What a removal left: `removed` is true only when every store reports nothing left. */
export interface BaseKnowledgeRemoval {
  removed: boolean
  stores: OfficeShelfRemoval & { records: 'removed'; caches: 'removed' | 'failed' }
}

/**
 * What a turn carries (`turn-context/service.ts`): the block and each copy's
 * answer-label data, or null when the flag is off for the organization. The
 * platform's listings and directives come through `platformKnowledge()` (ADR-0165). Read as the model
 * reads (`SCREENED_ONLY`), so a held upload stays out of the turn.
 */
export interface BaseKnowledgeTurn {
  /** The block the agent reads, or null. */
  block: string | null
  /** The data of each confirmed copy's answer label, for the answer's renderer. */
  labels: OfficeAnswerLabel[]
}

export async function baseKnowledgeForTurn(organizationId: string, projectId: string | null): Promise<BaseKnowledgeTurn | null> {
  // Confirmed copies, and licensed ones still proposals: those are named as held and never read (ADR-0164).
  const [all, profile] = await Promise.all([
    readOfficeEntries(organizationId),
    projectId ? findProjectProfileInOrg(projectId, organizationId) : Promise.resolve(null),
  ])
  const facts = profile?.profile?.facts ?? {}
  // Of a standard's editions, the one the platform's rule puts in force on the project's reference day.
  const day = referenceDayOfProfile(facts, dayOf(new Date()))
  // The edition in force is chosen among those the model may read, so a held upload never displaces a readable one.
  const documents = await visibleOfficeDocuments(organizationId, all.map((entry) => entry.documentId), SCREENED_ONLY)
  const readable = all.filter((entry) => documents.has(entry.documentId))
  const works = editionsByWork(readable)
  const stored = readable.filter((entry) =>
    entry.confirmed ? editionOnDay(works.get(entry.workId) ?? [entry], day) === entry : entry.values.licenceClass === 'licensed'
  )
  // Held is every confirmed copy the model may read, in force on the day or not: an office holding only a later
  // edition still holds the standard, and the turn must not call the platform's listing of it „not held“.
  const held = readable.flatMap((entry) => (entry.confirmed && entry.values.designation ? [entry.values.designation] : []))
  const [listed, setupRecords] = await Promise.all([
    platformKnowledge().listedNotHeld(organizationId, held),
    readSetupRecords(organizationId),
  ])
  const territory = projectTerritory({ federalState: facts.federal_state?.value, country: facts.country?.value }, subdivisionTerritories(setupRecords))
  const directives = await platformKnowledge().directivesFor(organizationId, territory.territoryId)
  const now = new Date()
  const entries = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now)] : []
  })
  return {
    block: renderBaseKnowledgeBlock(entries, territory, listed, directives),
    labels: entries.filter((entry) => entry.status === 'confirmed').map((entry) => officeAnswerLabel(entry, territory)),
  }
}
