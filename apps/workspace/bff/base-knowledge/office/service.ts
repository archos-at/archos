import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { deleteOfficeShelfDocument, uploadOfficeShelfDocument, type OfficeShelfRemoval } from '@/lib/office-shelf/service'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { forgetKeysFor } from '../http/idempotency'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import type { KnowledgeProvenance } from '@/lib/db/schema/knowledge-records'
import {
  deleteDocumentEntry,
  documentHasEntry,
  insertCopyCheck,
  insertProposedEntry,
  readOfficeEntries,
  relistDocumentEntry,
  unlistDocumentEntry,
  writeConfirmedValues,
  writeProposedValues,
  type StoredEntry,
} from '../store/repository'
import {
  ASK_FOR_LICENCE,
  ENTRY_PAGE,
  type BaseKnowledgeEntry,
  type BaseKnowledgeList,
  type BaseKnowledgeUnlisting,
  type ConfirmEntryBody,
  type DirectoryStanding,
  type EntryValues,
  type LicenceEntryBody,
  type UpdateEntryBody,
  type ListEntriesQuery,
  type ProposeEntryBody,
  type RecordCheckBody,
  type RelistEntryBody,
} from '../wire'
import { readSetupRecords } from '@/lib/project-intake/setup-records'
import { subdivisionTerritories } from '@/lib/project-intake/setup-scope'
import { projectTerritory } from './authority'
import { directoryStanding, freshnessOf } from './freshness'
import { markCopyPoints } from './mark'
import { proposeFromReading } from './reading'
import { readShelfDocument, visibleOfficeDocuments, type EntryDocument } from './repository'
import { releaseText, withholdText } from './text-effects'
import { licenceMarkOf, termsAfter, textUseOf } from './text-use'
import { renderBaseKnowledgeBlock, type TurnDay } from './turn-block'
import { officeAnswerLabel, type OfficeAnswerLabel } from './answer-label'
import { designationKey, platformKnowledge, type DirectoryEdition } from '../platform'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { territoryChoices } from './territory-choices'
import { isStandardsFolder, standardsFolderRows, standardsRoot } from './folders'
import { editionsByWork, editionsForDay, editionsOf, heldEditionsOf, newestOf } from './work-editions'
import { workDesignation } from './work-designation'
import { referenceDayOfProfile } from '../time/profile-procedure'
import { insertEditionOfWork, deleteWorkIfUnused } from '../store/office-editions'
import { byAttention, countByFolder, countEntries, matchesQuery, subtreeOf } from './listing'


function requireManage(session: AuthorizedSession): void {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

const reader = (session: AuthorizedSession) => shelfReaderFor(session, { scope: 'office_shelf', projectId: null })

type Names = ReadonlyMap<string, { name: string }>
const NO_NAMES: Names = new Map()

type Works = ReadonlyMap<string, StoredEntry[]>
const NO_WORKS: Works = new Map()
type Directory = ReadonlyMap<string, DirectoryEdition[]>
const NO_DIRECTORY: Directory = new Map()
const dayOf = (now: Date) => now.toISOString().slice(0, 10)

async function directoryOf(organizationId: string, entries: readonly StoredEntry[]): Promise<Directory> {
  const designations = entries.flatMap((entry) => (entry.confirmed && entry.values.designation ? [entry.values.designation] : []))
  if (designations.length === 0) return NO_DIRECTORY
  const works = await platformKnowledge().editionsOf(organizationId, designations)
  return new Map(works.map((work) => [designationKey(work.designation), work.editions]))
}

function standingIn(stored: StoredEntry, works: Works, directory: Directory, day: string) {
  if (!stored.confirmed || !stored.values.designation) return null
  const listed = directory.get(designationKey(stored.values.designation))
  return listed ? directoryStanding(heldEditionsOf(stored, works), listed, day) : null
}

function toEntry(
  stored: StoredEntry,
  document: EntryDocument,
  now: Date,
  names: Names = NO_NAMES,
  works: Works = NO_WORKS,
  directory: Directory = NO_DIRECTORY
): BaseKnowledgeEntry {
  const confirmedBy = stored.confirmed ? (stored.provenance.confirmedBy ?? null) : null
  return {
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
    textUse: textUseOf(stored.values.licenceClass, stored.terms, ASK_FOR_LICENCE),
    aiProcessingAttestedAt: stored.terms.aiProcessingAttestedAt ?? null,
    freshness: freshnessOf(stored.values.kind, stored.confirmed ? stored.lastCheck : null, now),
    directory: standingIn(stored, works, directory, dayOf(now)),
    folderId: document.folderId,
    editions: editionsOf(stored, works, dayOf(now)),
    createdAt: stored.createdAt.toISOString(),
  }
}

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
  const readable = stored.filter((entry) => documents.has(entry.documentId))
  const works = editionsByWork(readable)
  const directory = await directoryOf(session.organizationId, readable)
  const visible = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now, names, works, directory)] : []
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
  const readable = editions.filter((entry) => documents.has(entry.documentId))
  const works = editionsByWork(readable)
  const directory = await directoryOf(session.organizationId, readable)
  return { stored, entry: toEntry(stored, document, now, names, works, directory), document }
}

export interface WorkStanding {
  workId: string
  entryId: string
  designation: string
  standing: DirectoryStanding
}

export async function directoryStandingsOf(organizationId: string, now: Date = new Date()): Promise<WorkStanding[]> {
  const all = await readOfficeEntries(organizationId)
  const documents = await visibleOfficeDocuments(organizationId, all.map((entry) => entry.documentId), SCREENED_ONLY)
  const readable = all.filter((entry) => entry.confirmed && documents.has(entry.documentId))
  const works = editionsByWork(readable)
  const directory = await directoryOf(organizationId, readable)
  return [...works.values()].flatMap((editions) => {
    const [edition] = editions
    const standing = standingIn(edition, works, directory, dayOf(now))
    const designation = workDesignation(edition.values.designation)
    return standing && designation ? [{ workId: edition.workId, entryId: newestOf(editions).editionId, designation, standing }] : []
  })
}

export async function storedEntryOf(session: AuthorizedSession, entryId: string): Promise<{ stored: StoredEntry; entry: BaseKnowledgeEntry }> {
  const { stored, entry } = await findEntry(session, entryId)
  return { stored, entry }
}

export async function getBaseKnowledgeEntry(session: AuthorizedSession, entryId: string): Promise<BaseKnowledgeEntry> {
  const { entry, document } = await findEntry(session, entryId)
  if (entry.status === 'confirmed' && entry.textUse === 'used' && document.textWithheld) await releaseText(session, entry.documentId)
  return entry
}

function merged(base: EntryValues, given: Partial<EntryValues>): EntryValues {
  const defined = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined))
  const values = { ...base, ...defined } as EntryValues
  const start = values.inForceFrom ?? values.issuedOn
  if (start && values.inForceTo && values.inForceTo <= start) {
    throw new UnprocessableError(`inForceTo (${values.inForceTo}) is not after the edition's start (${start}); an edition ends after it starts.`)
  }
  return values.kind === 'authority_directive' ? values : { ...values, addressees: [] }
}

function valuesOf(body: Partial<EntryValues>): Partial<EntryValues> {
  const { kind, title, designation, editionLabel, issuedOn, inForceFrom, inForceTo, territoryIds, issuer, addressees, licenceClass } = body
  return { kind, title, designation, editionLabel, issuedOn, inForceFrom, inForceTo, territoryIds, issuer, addressees, licenceClass }
}

function editionValues(values: EntryValues): Pick<EntryValues, 'editionLabel' | 'issuedOn' | 'inForceFrom' | 'inForceTo' | 'designation'> {
  const { editionLabel, issuedOn, inForceFrom, inForceTo, designation } = values
  return { editionLabel, issuedOn, inForceFrom, inForceTo, designation }
}

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

export async function recordProposal(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  fileName: string,
  proposedBy: KnowledgeProvenance['proposedBy'],
  editionOf?: StoredEntry,
  { filedFrom }: Pick<KnowledgeProvenance, 'filedFrom'> = {}
): Promise<string> {
  if (await documentHasEntry(session.organizationId, body.documentId)) {
    throw new ConflictError('This document is already recorded as base knowledge; edit that entry instead.')
  }
  const given = valuesOf(body)
  const values = merged(proposeFromReading({ fileName }, subdivisionTerritories(await readSetupRecords(session.organizationId))), given)
  const source = Object.values(given).some((value) => value !== undefined) ? proposedBy : 'reading'
  const provenance: KnowledgeProvenance = filedFrom ? { proposedBy: source, filedFrom } : { proposedBy: source }
  const context = { organizationId: session.organizationId, createdBy: session.userId, provenance, terms: {} }
  const ids = editionOf
    ? await insertEditionOfWork(body.documentId, editionOf, { ...editionOf.values, ...editionValues(values), licenceClass: editionOf.values.licenceClass }, context)
    : await insertProposedEntry(body.documentId, values, context)
  return ids.editionId
}

export async function uploadBaseKnowledge(
  session: AuthorizedSession,
  file: File,
  request: Request,
  { folderId = null, editionOf, ...given }: Omit<ProposeEntryBody, 'documentId'> & { folderId?: string | null; editionOf?: StoredEntry } = {}
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
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
  if (ASK_FOR_LICENCE && values.licenceClass === 'licensed' && body.licenceAttested !== true) {
    throw new UnprocessableError(
      'A licensed copy needs licenceAttested: true, the office’s statement that its licence covers use by everyone in the office.'
    )
  }
}

async function writeValues(
  session: AuthorizedSession,
  { stored, document }: { stored: StoredEntry; document: EntryDocument },
  values: EntryValues,
  body: ConfirmEntryBody,
  firstCheck: boolean
): Promise<void> {
  const terms = termsAfter(stored.terms, body, session.userId, new Date())
  const written = stored.workStandsAlone ? { ...values, designation: workDesignation(values.designation) } : values
  await writeConfirmedValues(stored, written, {
    organizationId: session.organizationId,
    createdBy: session.userId,
    provenance: { proposedBy: stored.provenance.proposedBy ?? 'reading', confirmedBy: session.userId },
    terms,
    firstCheck,
  })
  const before = stored.confirmed && !document.textWithheld ? textUseOf(stored.values.licenceClass, stored.terms, ASK_FOR_LICENCE) : 'metadata_only'
  const after = textUseOf(values.licenceClass, terms, ASK_FOR_LICENCE)
  if (after === 'metadata_only') await withholdText(session, stored.documentId)
  else if (before === 'metadata_only') await releaseText(session, stored.documentId)
  else await markCopyPoints(document, stored.editionId, licenceMarkOf(values.licenceClass, terms, ASK_FOR_LICENCE))
}

export interface ConfirmOptions {
  licenceStep?: boolean
}

export async function confirmBaseKnowledge(
  session: AuthorizedSession,
  entryId: string,
  body: ConfirmEntryBody,
  { licenceStep = true }: ConfirmOptions = {}
): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const found = await findEntry(session, entryId)
  if (found.stored.confirmed) throw new ConflictError('This entry is already confirmed; edit it instead.')
  const values = merged(found.stored.values, valuesOf(body))
  if (licenceStep) requireAttestation(values, body)
  await writeValues(session, found, values, body, true)
  return (await findEntry(session, entryId)).entry
}

export async function reviseProposal(session: AuthorizedSession, entryId: string, body: Partial<EntryValues>): Promise<void> {
  requireManage(session)
  const { stored } = await findEntry(session, entryId)
  if (stored.confirmed) throw new ConflictError('This entry is confirmed; edit it with base-knowledge-update instead.')
  const values = merged(stored.values, valuesOf(body))
  if (JSON.stringify(values) === JSON.stringify(stored.values)) return
  const { filedFrom } = stored.provenance
  await writeProposedValues(stored, values, {
    organizationId: session.organizationId,
    createdBy: session.userId,
    provenance: filedFrom ? { proposedBy: 'person', filedFrom } : { proposedBy: 'person' },
    terms: stored.terms,
  })
}

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

export async function removeBaseKnowledge(session: AuthorizedSession, entryId: string, request: Request): Promise<BaseKnowledgeRemoval> {
  requireManage(session)
  const { stored } = await findEntry(session, entryId)
  const stores = await deleteOfficeShelfDocument(session, stored.documentId, request)
  if (stored.workStandsAlone) await deleteWorkIfUnused(session.organizationId, stored.workId)
  const caches = (await forgetKeysFor(session.organizationId, [entryId, stored.documentId])) ? 'removed' : 'failed'
  return {
    removed: stores.search !== 'failed' && stores.objects === 'removed' && caches === 'removed',
    stores: { ...stores, records: 'removed', caches },
  }
}

export async function dropBaseKnowledgeRecords(session: AuthorizedSession, stored: StoredEntry): Promise<void> {
  requireManage(session)
  await deleteDocumentEntry(session.organizationId, stored.documentId)
  if (stored.workStandsAlone) await deleteWorkIfUnused(session.organizationId, stored.workId)
  await releaseText(session, stored.documentId)
  await forgetKeysFor(session.organizationId, [stored.editionId, stored.documentId])
}

export async function unlistBaseKnowledge(session: AuthorizedSession, entryId: string): Promise<BaseKnowledgeUnlisting> {
  requireManage(session)
  const { stored, entry } = await findEntry(session, entryId)
  const moved = await moveDocumentToFolder({ documentId: stored.documentId, folderId: null }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
  await unlistDocumentEntry(session.organizationId, stored.documentId)
  await releaseText(session, stored.documentId)
  await forgetKeysFor(session.organizationId, [stored.editionId, stored.documentId])
  return { documentId: stored.documentId, folderId: null, entryId: stored.editionId, formerFolderId: entry.folderId }
}

export async function relistBaseKnowledge(session: AuthorizedSession, entryId: string, { folderId }: RelistEntryBody): Promise<BaseKnowledgeEntry> {
  requireManage(session)
  const parked = (await readOfficeEntries(session.organizationId, undefined, { unlisted: true })).find((entry) => entry.editionId === entryId)
  if (!parked) throw new NotFoundError('No entry taken off the norms with this id: its file was proposed again or removed.')
  const target = folderId && (await isStandardsFolder(session, folderId)) ? folderId : (await standardsRoot(session.organizationId)).id
  const moved = await moveDocumentToFolder({ documentId: parked.documentId, folderId: target }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
  if (!(await relistDocumentEntry(session.organizationId, parked.documentId))) {
    throw new NotFoundError('No entry taken off the norms with this id: its file was proposed again or removed.')
  }
  const { entry } = await findEntry(session, entryId)
  if (entry.status === 'confirmed' && entry.textUse === 'used') await releaseText(session, parked.documentId)
  else await withholdText(session, parked.documentId)
  await forgetKeysFor(session.organizationId, [entryId, parked.documentId])
  return entry
}

export interface BaseKnowledgeRemoval {
  removed: boolean
  stores: OfficeShelfRemoval & { records: 'removed'; caches: 'removed' | 'failed' }
}

export interface BaseKnowledgeTurn {
  block: string | null
  labels: OfficeAnswerLabel[]
}

export async function baseKnowledgeForTurn(organizationId: string, projectId: string | null): Promise<BaseKnowledgeTurn | null> {
  const [all, profile] = await Promise.all([
    readOfficeEntries(organizationId),
    projectId ? findProjectProfileInOrg(projectId, organizationId) : Promise.resolve(null),
  ])
  const facts = profile?.profile?.facts ?? {}
  const today = dayOf(new Date())
  const reference = referenceDayOfProfile(facts, today)
  const day: TurnDay = { day: reference ?? today, basis: reference ? 'reference_day' : projectId ? 'no_reference_day' : 'no_project' }
  const documents = await visibleOfficeDocuments(organizationId, all.map((entry) => entry.documentId), SCREENED_ONLY)
  const readable = all.filter((entry) => documents.has(entry.documentId))
  const held = readable.flatMap((entry) => (entry.confirmed && entry.values.designation ? [entry.values.designation] : []))
  const [listed, directory, setupRecords] = await Promise.all([
    platformKnowledge().listedNotHeld(organizationId, held),
    platformKnowledge().editionsOf(organizationId, held),
    readSetupRecords(organizationId),
  ])
  const { stored, missing } = editionsForDay(readable, directory, day.day, documents)
  const territory = projectTerritory({ federalState: facts.federal_state?.value, country: facts.country?.value }, subdivisionTerritories(setupRecords))
  const directives = await platformKnowledge().directivesFor(organizationId, territory.territoryId)
  const now = new Date()
  const entries = stored.flatMap((entry) => {
    const document = documents.get(entry.documentId)
    return document ? [toEntry(entry, document, now)] : []
  })
  const labels = entries.filter((entry) => entry.status === 'confirmed').map((entry) => officeAnswerLabel(entry, territory))
  if (labels.length > 0) {
    captureServer({
      event: 'office_norm_cited',
      distinctId: null,
      organizationId,
      properties: { office_norms: labels.length, has_project: projectId !== null },
    })
  }
  return {
    block: renderBaseKnowledgeBlock(entries, territory, listed, directives, { day, missing }),
    labels,
  }
}
