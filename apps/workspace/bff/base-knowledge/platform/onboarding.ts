import 'server-only'
import { ApiError, ConflictError, NotFoundError, ServiceUnavailableError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingClientId } from '@/lib/agent-api/acting-session'
import { CAPTURE_REFUSAL_CODES, CaptureFetchError, type ConfiguredSource, fetchSourcePage } from './capture-fetch'
import { checksOutsideKit, textChecksOf } from './text-checks'
import { otherRecordNaming, pinnedTexts } from './text-store'
import { activeSource, fetchedThrough, revealedCredential, type RegisteredSource, usableSource } from './sources'
import { capturesOf, citedCaptureIds, insertCapture, sha256Of } from './captures'
import { referencesOf } from './records'
import { recordSchemas } from './record-schemas'
import { requirePlatform } from './service-gate'
import {
  type ChangeRequestRow,
  idsOfBatch,
  knownPlatformRecords,
  lockChangeRequest,
  newestPerRecord,
  platformEditionsOf,
  platformTransaction,
  requestRevisions,
} from './store'
import type { Tx } from '../store/repository'
import { KIT_CHECKS, KIT_PROBLEM_TYPE_BASE, kitProblem, namedTerritories, type Problem, validateProposal } from './validate'
import {
  type CaptureBody,
  type CaptureView,
  PROPOSED_RECORD_TYPES,
  type ProposedRecord,
  proposedRecordSchema,
  type ValidationView,
} from './wire'

export async function runKit(
  tx: Tx,
  request: ChangeRequestRow,
  records: readonly ProposedRecord[],
  sourceChecks: ReadonlyMap<string, readonly Problem[]> = new Map(),
): Promise<Problem[]> {
  const named = (record: ProposedRecord) => [...referencesOf(record).map((reference) => reference.id), ...namedTerritories(record)]
  const workIds = [...new Set(records.flatMap((record) => (record.type === 'edition' ? [`work:${record.workKey}`] : [])))]
  const [known, captures, existing, taken] = await Promise.all([
    knownPlatformRecords(tx, idsOfBatch(records, named)),
    capturesOf(tx, request.id, citedCaptureIds(records)),
    platformEditionsOf(tx, workIds),
    takenNames(tx, records),
  ])
  return [...validateProposal(records, request.countryId, known, captures, existing, sourceChecks), ...taken]
}

async function takenNames(tx: Tx, records: readonly ProposedRecord[]): Promise<Problem[]> {
  const problems: Problem[] = []
  const inBatch = new Map<string, string>()
  for (const [index, record] of records.entries()) {
    if (record.type !== 'manifestation' || record.corpusFile === null) continue
    const id = `manifestation:${record.key}`
    const other = inBatch.get(record.corpusFile) ?? (await otherRecordNaming(tx, record.corpusFile, id))
    inBatch.set(record.corpusFile, inBatch.get(record.corpusFile) ?? id)
    if (!other || other === id) continue
    problems.push({
      ...kitProblem(
        'KC-1',
        record,
        '/corpusFile',
        `names ${record.corpusFile}, which is the text of ${other} (NAME_TAKEN): a file is one record's text.`,
        'Attach this manifestation its own text under another file name with platform-knowledge-text-import (fileName) or platform-knowledge-text-upload.',
      ),
      index,
    })
  }
  return problems
}

async function storedProposals(tx: Tx, requestId: string): Promise<{ records: ProposedRecord[]; unreadable: Problem[] }> {
  const records: ProposedRecord[] = []
  const unreadable: Problem[] = []
  for (const revision of newestPerRecord(await requestRevisions(tx, requestId))) {
    const parsed = proposedRecordSchema.safeParse(revision.provenance.proposal)
    if (parsed.success) {
      records.push(parsed.data)
      continue
    }
    unreadable.push({
      type: `${KIT_PROBLEM_TYPE_BASE}kc-1`,
      code: 'KC-1',
      key: revision.recordId,
      recordId: revision.recordId,
      pointer: '',
      detail: 'was proposed before the kit kept proposals, so it cannot be checked.',
      hint: 'Propose the record again in this request with platform-knowledge-records-propose.',
    })
  }
  return { records, unreadable }
}

export async function requestSourceChecks(requestId: string): Promise<Map<string, Problem[]>> {
  const { records, pinned } = await platformTransaction(async (tx) => ({
    ...(await storedProposals(tx, requestId)),
    pinned: await pinnedTexts(tx, requestId),
  }))
  return (await checksOutsideKit(records, pinned, false, requestId)).checks
}

export async function requestTextProblems(requestId: string): Promise<Problem[]> {
  const { records, pinned } = await platformTransaction(async (tx) => ({
    ...(await storedProposals(tx, requestId)),
    pinned: await pinnedTexts(tx, requestId),
  }))
  return [...(await textChecksOf(records, pinned)).checks.values()].flat()
}

export async function validateRequest(
  tx: Tx,
  request: ChangeRequestRow,
  sourceChecks: ReadonlyMap<string, readonly Problem[]> = new Map(),
): Promise<ValidationView> {
  const { records, unreadable } = await storedProposals(tx, request.id)
  const problems = [...unreadable, ...(await runKit(tx, request, records, sourceChecks))].map(({ index: _index, ...problem }) => problem)
  return {
    changeRequestId: request.id,
    valid: problems.length === 0 && records.length + unreadable.length > 0,
    records: records.length + unreadable.length,
    checks: KIT_CHECKS,
    problems,
  }
}

export async function validatePlatformChangeRequest(session: UserSession | null, requestId: string): Promise<ValidationView> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const sourceChecks = await requestSourceChecks(requestId)
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    return validateRequest(tx, request, sourceChecks)
  })
}

const CAPTURE_REFUSAL_HINTS: Readonly<Record<(typeof CAPTURE_REFUSAL_CODES)[number], string>> = {
  egress_refused: 'Use a URL on a host of the source, or upload the page as operator_supplied.',
  body_too_large: 'Capture a smaller document (one part of it), or upload the text you cite as operator_supplied and say why in note.',
  pdf_encrypted: 'Find a copy without a password or the publisher’s HTML version, or upload the text as operator_supplied and say why in note.',
  pdf_malformed: 'Find another copy of the document, or upload the text as operator_supplied and say why in note.',
  pdf_too_many_pages: 'Capture the part of the document you cite (most publishers split long PDFs), or upload that text as operator_supplied.',
  pdf_parse_timeout: 'Try again later; if it keeps timing out, upload the text as operator_supplied and say why in note.',
  pdf_reader_failed:
    'The reader stopped on this file (its memory ceiling, or a crash): find a smaller or simpler copy, or upload the text as operator_supplied and say why in note.',
}

function refusedCapture(code: string, message: string): ApiError {
  const hint = (CAPTURE_REFUSAL_HINTS as Record<string, string>)[code] ?? 'Upload the page as operator_supplied and say why in note.'
  return new ApiError(422, code.toUpperCase(), message, { hint })
}

async function captured(body: CaptureBody, configured: ConfiguredSource | undefined) {
  if (body.basis === 'operator_supplied') {
    return {
      sourceId: null,
      url: body.url,
      finalUrl: null,
      contentType: 'text/plain; charset=utf-8',
      sha256: sha256Of(body.text),
      bytes: Buffer.byteLength(body.text, 'utf8'),
      text: body.text,
      note: body.note ?? null,
      retrievedAt: new Date(),
    }
  }
  try {
    const page = await fetchSourcePage(body.sourceId, body.url, configured)
    return { ...page, sourceId: body.sourceId, retrievedAt: new Date(page.retrievedAt) }
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    if (error.code) throw refusedCapture(error.code, error.message)
    if (error.status === 404) throw new NotFoundError(error.message)
    if (error.status === 403) throw new UnprocessableError(error.message, { hint: 'Use a URL on a host of the source, or upload the page as operator_supplied.' })
    throw new ServiceUnavailableError(error.message)
  }
}

export async function keyMayGo(tx: Tx, source: RegisteredSource): Promise<boolean> {
  if (source.state === 'active') return true
  const released = await activeSource(tx, source.key)
  if (!released) return false
  const header = (config: Record<string, unknown>) => JSON.stringify(config.credential ?? null)
  return header(source.config) === header(released.config) && source.hosts.every((host) => released.hosts.includes(host))
}

export async function configuredSource(tx: Tx, source: RegisteredSource): Promise<ConfiguredSource> {
  const credential = (await keyMayGo(tx, source)) ? await revealedCredential(tx, source.recordId) : null
  return { config: source.config, ...(credential ? { credential } : {}) }
}

export async function capturePlatformCitation(session: UserSession | null, requestId: string, body: CaptureBody): Promise<CaptureView> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  return captureAs(person.userId, requestId, body)
}

export async function captureAs(capturer: string, requestId: string, body: CaptureBody): Promise<CaptureView> {
  const person = { userId: capturer }
  const { draft, configured, through } = await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    const source = body.basis === 'fetched' && request ? await usableSource(tx, body.sourceId, requestId) : null
    const through = body.basis === 'fetched' ? fetchedThrough(source) : { sourceOrigin: null, sourceRevisionId: null }
    return { draft: request, configured: source ? await configuredSource(tx, source) : undefined, through }
  })
  if (!draft) throw new NotFoundError('No change request with this id; list them first.')
  if (draft.status !== 'draft') throw new ConflictError(`The change request is ${draft.status}; captures go into a draft.`)
  const page = await captured(body, configured)
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (request?.status !== 'draft') throw new ConflictError('The change request left draft while the page was fetched.')
    return insertCapture(tx, {
      changeRequestId: requestId,
      basis: body.basis,
      ...page,
      ...through,
      createdBy: person.userId,
      viaClient: actingClientId() ?? null,
    })
  })
}

export async function platformKnowledgeSchemas(session: UserSession | null, type: (typeof PROPOSED_RECORD_TYPES)[number] | undefined) {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const types = type ? [type] : [...PROPOSED_RECORD_TYPES]
  const answer = recordSchemas(types)
  const missing = types.find((name) => !answer.recordTypes[name])
  if (missing) throw new NotFoundError(`No record type ${missing}.`)
  return answer
}
