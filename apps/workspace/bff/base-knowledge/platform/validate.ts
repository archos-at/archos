/**
 * The validation kit (ADR-0165, ADR-0170, design §4.6), run on every proposal,
 * by `platform-knowledge-validate` and again on submit: a proposal that fails a
 * check is not written. Pure.
 *
 * - KC-1: every record a proposal names exists (in the batch or released or
 *   drafted on the platform) with the type it must have; a record keeps its
 *   type and its country; a territory belongs to the request's country; no
 *   record is proposed twice in one batch.
 * - KC-3: intervals are ordered.
 * - KC-6: every record cites at least one capture of its change request, and
 *   every quote it gives is found in that capture's stored text. Whoever
 *   proposed it, a person or an agent: an agent cannot verify a page it made
 *   up, because the capture is the page the product fetched (or the file an
 *   operator uploaded, which the reviewer must check against its source).
 *
 * Each problem is an RFC 9457 problem's member (`type`, `code`, `detail`) with
 * the record it is about and an RFC 6901 `pointer` into that record, so an
 * agent repairs the field and resends the batch with the same keys.
 *
 * The rest of the kit (anchors, hosts, level obligations, instruction-like
 * text) needs sources and rulesets that arrive later; until then a reviewer
 * checks those claim by claim.
 */

import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { quoteFound } from './quote'
import { proposalKey, recordIdOf, referencesOf } from './records'
import type { ProposedRecord } from './wire'

/** A platform record that already exists: its type and country. */
export interface KnownRecord {
  type: KnowledgeRecordType
  countryId: string
}

/** A capture of the change request, as KC-6 reads it. */
export interface KnownCapture {
  /** The text the quote is looked for in; null when the capture holds none (a binary file). */
  text: string | null
  basis: 'fetched' | 'operator_supplied'
}

export const KIT_CHECKS = ['KC-1', 'KC-3', 'KC-6'] as const
export type KitCheck = (typeof KIT_CHECKS)[number]

/** Where each check is described: one problem type per check, as RFC 9457 asks. */
export const KIT_PROBLEM_TYPE_BASE = 'urn:problem-type:knowledge-check:'

/** What an agent does about each check, in one line. */
export const KIT_HINTS: Readonly<Record<KitCheck, string>> = {
  'KC-1': 'Propose the named record in this batch, import the territory first, or fix the key.',
  'KC-3': 'Order the dates: the end lies after the start.',
  'KC-6':
    'Capture the page with platform-knowledge-citation-capture, cite its captureId, and quote words exactly as the capture has them.',
}

export interface Problem {
  type: string
  code: KitCheck
  /** The proposal's key (or a territory's id) the problem is about. */
  key: string
  recordId: string
  /** RFC 6901 JSON Pointer into the record: `/citations/0/quote`, `/workKey`. */
  pointer: string
  detail: string
  hint: string
  /** The record's position in the proposed batch; absent when a stored request is validated. */
  index?: number
}

function problem(code: KitCheck, record: ProposedRecord, pointer: string, detail: string): Problem {
  return {
    type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`,
    code,
    key: proposalKey(record),
    recordId: recordIdOf(record),
    pointer,
    detail,
    hint: KIT_HINTS[code],
  }
}

function territoryCountry(territoryId: string): string {
  return territoryId.slice(0, 2)
}

function intervalProblems(record: ProposedRecord): Problem[] {
  if (record.type === 'edition' && record.inForceFrom && record.inForceTo && record.inForceTo < record.inForceFrom) {
    return [problem('KC-3', record, '/inForceTo', 'inForceTo lies before inForceFrom.')]
  }
  if (record.type === 'territory' && record.validFrom && record.validTo && record.validTo <= record.validFrom) {
    return [problem('KC-3', record, '/validTo', 'validTo must lie after validFrom (intervals are half-open).')]
  }
  return []
}

/** The territories a record names, which must exist, with where each is named. */
export function namedTerritories(record: ProposedRecord): string[] {
  return namedTerritoryFields(record).map(([territoryId]) => territoryId)
}

function namedTerritoryFields(record: ProposedRecord): [string, string][] {
  if (record.type === 'territory') return record.parentIds.map((id, i) => [id, `/parentIds/${i}`])
  if (record.type === 'authority') {
    return [[record.seatTerritoryId, '/seatTerritoryId'], ...record.competenceTerritoryIds.map((id, i): [string, string] => [id, `/competenceTerritoryIds/${i}`])]
  }
  if (record.type === 'work') {
    return [
      ...record.territoryIds.map((id, i): [string, string] => [id, `/territoryIds/${i}`]),
      ...record.addressees.map((addressee, i): [string, string] => [addressee.territoryId, `/addressees/${i}/territoryId`]),
    ]
  }
  return []
}

/** The field a reference is named by, for the pointer. */
const REFERENCE_FIELD: Readonly<Record<string, string>> = { edition: '/workKey', manifestation: '/editionKey', work: '/addressees' }

/** KC-6: the record cites a capture of its request, and every quote is in that capture. */
export function citationProblems(record: ProposedRecord, captures: ReadonlyMap<string, KnownCapture>): Problem[] {
  const problems: Problem[] = []
  if (!record.citations.some((citation) => citation.captureId)) {
    problems.push(problem('KC-6', record, '/citations', 'cites no capture; a platform record is proposed only with a captured source.'))
  }
  record.citations.forEach((citation, i) => {
    if (!citation.captureId) {
      if (citation.url) problems.push(problem('KC-6', record, `/citations/${i}/url`, `${citation.url} is not captured; cite a capture instead of a bare link.`))
      return
    }
    const capture = captures.get(citation.captureId)
    if (!capture) {
      problems.push(problem('KC-6', record, `/citations/${i}/captureId`, `${citation.captureId} is no capture of this change request.`))
      return
    }
    if (!citation.quote) {
      problems.push(problem('KC-6', record, `/citations/${i}/quote`, 'quotes nothing; give the words in the capture that support the record.'))
      return
    }
    if (capture.text === null) {
      problems.push(problem('KC-6', record, `/citations/${i}/captureId`, 'the capture holds no text to check the quote in; capture a text page or upload its text.'))
      return
    }
    if (!quoteFound(citation.quote, capture.text)) {
      problems.push(problem('KC-6', record, `/citations/${i}/quote`, 'the quote is not in the capture; copy it exactly as the captured page has it.'))
    }
  })
  return problems
}

export function validateProposal(
  records: readonly ProposedRecord[],
  countryId: string,
  known: ReadonlyMap<string, KnownRecord>,
  captures: ReadonlyMap<string, KnownCapture>,
): Problem[] {
  const batch = new Map<string, KnowledgeRecordType>()
  const problems: Problem[][] = records.map(() => [])
  records.forEach((record, index) => {
    const id = recordIdOf(record)
    const own = problems[index] as Problem[]
    if (batch.has(id)) own.push(problem('KC-1', record, '', `${id} is proposed twice in one batch.`))
    batch.set(id, record.type)
    const existing = known.get(id)
    if (existing && existing.type !== record.type) {
      own.push(problem('KC-1', record, '/type', `${id} exists as a ${existing.type}; a record keeps its type.`))
    }
    if (existing && existing.countryId !== countryId) {
      own.push(problem('KC-1', record, '', `${id} belongs to ${existing.countryId}; propose it in a request for that country.`))
    }
    if (record.type === 'territory' && record.kind !== 'union' && territoryCountry(record.id) !== countryId) {
      own.push(problem('KC-1', record, '/id', `${record.id} lies outside ${countryId}, the country of this request.`))
    }
  })
  const exists = (id: string, type: KnowledgeRecordType) => batch.get(id) === type || known.get(id)?.type === type
  records.forEach((record, index) => {
    const own = problems[index] as Problem[]
    for (const reference of referencesOf(record)) {
      if (!exists(reference.id, reference.type)) {
        own.push(problem('KC-1', record, REFERENCE_FIELD[record.type] ?? '', `names ${reference.id}, which is no ${reference.type} on the platform or in this batch.`))
      }
    }
    for (const [territoryId, pointer] of namedTerritoryFields(record)) {
      if (!exists(territoryId, 'territory')) {
        own.push(problem('KC-1', record, pointer, `names territory ${territoryId}, which is not imported; import it first.`))
      }
    }
    own.push(...intervalProblems(record), ...citationProblems(record, captures))
  })
  return problems.flatMap((own, index) => own.map((found) => ({ ...found, index })))
}
