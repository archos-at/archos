/**
 * What an operator's agent needs on the platform door to onboard a country
 * (ADR-0170, design §4.3), beside the change-request flow of `service.ts`:
 *
 * - the kit run on a batch or on a whole stored request (`validate`), one
 *   function for both, so a request that validated green submits;
 * - citation captures, fetched through the public-source fetcher or supplied
 *   by an operator, which KC-6 checks every quote against;
 * - the JSON Schema of every record type, from the same zod the routes parse.
 *
 * Reads take `platform:settings:view`, writes `platform:settings:manage`, and
 * all of it answers 403 until the platform has the `platform-base-knowledge`
 * flag (`requirePlatform`).
 */

import 'server-only'
import { z } from 'zod'
import { ConflictError, NotFoundError, ServiceUnavailableError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingClientId } from '@/lib/agent-api/acting-session'
import { CaptureFetchError, fetchSourcePage } from './capture-fetch'
import { capturesOf, citedCaptureIds, insertCapture, sha256Of } from './captures'
import { referencesOf } from './records'
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
import { KIT_CHECKS, KIT_HINTS, KIT_PROBLEM_TYPE_BASE, namedTerritories, type Problem, validateProposal } from './validate'
import {
  type CaptureBody,
  type CaptureView,
  citationSchema,
  MAX_PROPOSED_RECORDS,
  PROPOSED_RECORD_TYPES,
  type ProposedRecord,
  proposedRecordSchema,
  type ValidationView,
} from './wire'

/** The kit on `records` as they would stand in `request`: KC-1, KC-3 and KC-6. */
export async function runKit(tx: Tx, request: ChangeRequestRow, records: readonly ProposedRecord[]): Promise<Problem[]> {
  const named = (record: ProposedRecord) => [...referencesOf(record).map((reference) => reference.id), ...namedTerritories(record)]
  const workIds = [...new Set(records.flatMap((record) => (record.type === 'edition' ? [`work:${record.workKey}`] : [])))]
  const [known, captures, existing] = await Promise.all([
    knownPlatformRecords(tx, idsOfBatch(records, named)),
    capturesOf(tx, request.id, citedCaptureIds(records)),
    platformEditionsOf(tx, workIds),
  ])
  return validateProposal(records, request.countryId, known, captures, existing)
}

/**
 * The request's records as proposed: the newest revision of each, read back
 * from what was proposed. A revision whose proposal cannot be read (written
 * before the kit kept it) is a problem, never a pass: unknown fails closed.
 */
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

/** The kit on everything a request holds: what submit runs, and what an agent runs before it. */
export async function validateRequest(tx: Tx, request: ChangeRequestRow): Promise<ValidationView> {
  const { records, unreadable } = await storedProposals(tx, request.id)
  const problems = [...unreadable, ...(await runKit(tx, request, records))].map(({ index: _index, ...problem }) => problem)
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
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    return validateRequest(tx, request)
  })
}

/** Fetch the page now, or take the operator's text: the bytes' digest and the text the quote check reads. */
async function captured(body: CaptureBody) {
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
    const page = await fetchSourcePage(body.sourceId, body.url)
    return { ...page, sourceId: body.sourceId, note: null, retrievedAt: new Date(page.retrievedAt) }
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    if (error.status === 404) throw new NotFoundError(error.message)
    if (error.status === 403) throw new UnprocessableError(error.message, { hint: 'Use a URL on a host of the source, or upload the page as operator_supplied.' })
    // Nothing was stored; the agent retries, or uploads the page as operator_supplied.
    throw new ServiceUnavailableError(error.message)
  }
}

/** Capture a page into a draft request: what records then cite, and KC-6 checks quotes against. */
export async function capturePlatformCitation(session: UserSession | null, requestId: string, body: CaptureBody): Promise<CaptureView> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  const draft = await platformTransaction((tx) => lockChangeRequest(tx, requestId))
  if (!draft) throw new NotFoundError('No change request with this id; list them first.')
  if (draft.status !== 'draft') throw new ConflictError(`The change request is ${draft.status}; captures go into a draft.`)
  // Fetched outside the transaction: a slow source must not hold the request's lock.
  const page = await captured(body)
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (request?.status !== 'draft') throw new ConflictError('The change request left draft while the page was fetched.')
    return insertCapture(tx, {
      changeRequestId: requestId,
      basis: body.basis,
      ...page,
      createdBy: person.userId,
      viaClient: actingClientId() ?? null,
    })
  })
}

/** Each record type's JSON Schema (what `records-propose` takes), the citation's, and the kit's checks. */
export async function platformKnowledgeSchemas(session: UserSession | null, type: (typeof PROPOSED_RECORD_TYPES)[number] | undefined) {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const types = type ? [type] : [...PROPOSED_RECORD_TYPES]
  const variants = proposedRecordSchema.options
  const recordTypes = Object.fromEntries(
    types.map((name) => {
      const variant = variants.find((option) => option.shape.type.value === name)
      if (!variant) throw new NotFoundError(`No record type ${name}.`)
      return [name, z.toJSONSchema(variant, { io: 'input', unrepresentable: 'any' })]
    }),
  )
  return {
    recordTypes,
    citation: z.toJSONSchema(citationSchema, { io: 'input', unrepresentable: 'any' }),
    maxBatch: MAX_PROPOSED_RECORDS,
    checks: KIT_CHECKS.map((code) => ({ code, type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`, hint: KIT_HINTS[code] })),
  }
}
