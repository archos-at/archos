/**
 * The validation kit (ADR-0165, ADR-0170, design §4.6), run on every proposal,
 * by `platform-knowledge-validate` and again on submit: a proposal that fails a
 * check is not written. Pure.
 *
 * - KC-1: every record a proposal names exists (in the batch or released or
 *   drafted on the platform) with the type it must have; a record keeps its
 *   type and its country; a territory belongs to the request's country; no
 *   record is proposed twice in one batch. A manifestation's `corpusFile` is a
 *   file the base corpus holds, so a publish never names a text that is not
 *   there (ADR-0165, "Texts are attached in the request"). The corpus is the
 *   api tier's, so that answer is handed in like KC-7's (`checkedOutside`).
 * - KC-3: intervals are ordered, and no two editions of one work are in force
 *   on the same day: two in one batch, or a new one beside one already on the
 *   platform (the as-of resolver refuses that as ambiguous, so it is refused
 *   here first).
 * - KC-5: a ruleset's, a transition's and an edition scope's own examples hold on the evaluator.
 * - KC-7: a source record parses as its access type and engine read it, and
 *   every recorded fixture passes with no live call (ADR-0174). The api tier
 *   runs it, so its problems are handed in (`checkedOutside`); an api tier that
 *   cannot answer is a problem, never a pass.
 * - KC-6: every record cites at least one capture of its change request, and
 *   every quote it gives is found in that capture's stored text, is long
 *   enough to say something, and one names what the record claims (its name,
 *   designation or label). Whoever proposed it, a person or an agent: an agent
 *   cannot verify a page it made up, because the capture is the page the
 *   product fetched (or the text an operator pasted, which the reviewer must
 *   check against its source).
 *
 * Each problem is an RFC 9457 problem's member (`type`, `code`, `detail`) with
 * the record it is about and an RFC 6901 `pointer` into that record, so an
 * agent repairs the field and resends the batch with the same keys.
 *
 * The rest of the kit (anchors, hosts, level obligations, instruction-like
 * text) needs sources and packs that arrive later; until then a reviewer
 * checks those claim by claim.
 */

import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { failingExamples } from '../rulesets/decision-table'
import type { DecisionTable } from '../wire/ruleset'
import { dayAfter } from '../time/editions'
import { normalizeForQuote, quoteFound, quoteLongEnough } from './quote'
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

export const KIT_CHECKS = ['KC-1', 'KC-3', 'KC-5', 'KC-6', 'KC-7'] as const
export type KitCheck = (typeof KIT_CHECKS)[number]

/** Where each check is described: one problem type per check, as RFC 9457 asks. */
export const KIT_PROBLEM_TYPE_BASE = 'urn:problem-type:knowledge-check:'

/** What an agent does about each check, in one line. */
export const KIT_HINTS: Readonly<Record<KitCheck, string>> = {
  'KC-1': 'Propose the named record in this batch, import the territory first, or fix the key.',
  'KC-3': 'Order the dates, and end one edition of a work before the next begins.',
  'KC-5': 'Correct the table or its examples so that each example holds on the evaluator.',
  'KC-6':
    'Capture the page with platform-knowledge-citation-capture, cite its captureId, and quote at least three words ' +
    'exactly as the capture has them, including what the record names (its name, designation or label).',
  'KC-7':
    'Repair the source record so it parses, its hosts cover every URL it names, and each recorded fixture passes; ' +
    'platform-knowledge-source-test shows what each fixture requested and found.',
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

/** A problem of the kit about `record`: for checks that run outside this module (KC-7, a text's file); `hint` when the check's own does not fit. */
export function kitProblem(code: KitCheck, record: ProposedRecord, pointer: string, detail: string, hint?: string): Problem {
  return { ...problem(code, record, pointer, detail), ...(hint ? { hint } : {}) }
}

/** Whether a check that runs outside this module (on the api tier) must have answered for `record`. */
export function checkedOutsideKit(record: ProposedRecord): boolean {
  return record.type === 'source' || (record.type === 'manifestation' && record.corpusFile !== null)
}

/** Unknown fails closed: a record the api tier did not check is a problem, never a pass. */
function uncheckedProblem(record: ProposedRecord): Problem {
  return record.type === 'source'
    ? problem('KC-7', record, '', 'was not checked; run the proposal again.')
    : problem('KC-1', record, '/corpusFile', 'was not checked against the base corpus; run the proposal again.')
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
  if (record.type === 'edition' && record.inForceFrom && record.inForceTo && record.inForceTo <= record.inForceFrom) {
    return [problem('KC-3', record, '/inForceTo', 'inForceTo must lie after inForceFrom (intervals are half-open: inForceTo is the first day no longer in force).')]
  }
  if ((record.type === 'territory' || record.type === 'relation') && record.validFrom && record.validTo && record.validTo <= record.validFrom) {
    return [problem('KC-3', record, '/validTo', 'validTo must lie after validFrom (intervals are half-open).')]
  }
  if (record.type === 'territory') {
    const index = record.parents.findIndex((parent) => parent.validFrom && parent.validTo && parent.validTo <= parent.validFrom)
    if (index >= 0) return [problem('KC-3', record, `/parents/${index}`, `the interval of parent ${record.parents[index]!.id} is empty or reversed.`)]
  }
  return []
}

/** An edition already on the platform (at its head), with its work and dates: what a proposal must not overlap. */
export interface DatedPlatformEdition {
  id: string
  workId: string
  inForceFrom: string | null
  inForceTo: string | null
}

/** Two half-open intervals share a day: one ending on the day the other begins does not. */
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string | null }) =>
  a.from < (b.to ?? '9999-12-31') && b.from < (a.to ?? '9999-12-31')

/** `earlier` ends the day before `later` begins: a source's printed last day entered as the exclusive end. */
const oneDayApart = (earlier: { to: string | null }, later: { from: string }) => earlier.to !== null && dayAfter(earlier.to) === later.from

/**
 * Editions of one work in force on the same day (intervals are half-open), or
 * one day apart, which is the last day in force copied as the end:
 * two proposed in one batch, or one proposed beside one already on the
 * platform. A batch that re-proposes the existing edition (closing its
 * `inForceTo`) is compared against its new dates, not its old ones.
 */
function overlapProblems(records: readonly ProposedRecord[], existing: readonly DatedPlatformEdition[]): [number, Problem][] {
  const proposed = records.flatMap((record, index) =>
    record.type === 'edition' && record.inForceFrom
      ? [{ index, record, key: record.key, workId: `work:${record.workKey}`, from: record.inForceFrom, to: record.inForceTo }]
      : [],
  )
  const inBatch = new Set(records.map(recordIdOf))
  const others = existing.flatMap((edition) =>
    edition.inForceFrom && !inBatch.has(edition.id)
      ? [{ key: edition.id, workId: edition.workId, from: edition.inForceFrom, to: edition.inForceTo }]
      : [],
  )
  const found: [number, Problem][] = []
  for (const [position, first] of proposed.entries()) {
    for (const second of [...proposed.slice(position + 1), ...others]) {
      if (first.workId !== second.workId) continue
      if (overlaps(first, second)) {
        found.push([first.index, problem('KC-3', first.record, '/inForceFrom', `is in force on days ${second.key} is; let one end (inForceTo, exclusive) on the day the other begins.`)])
      } else if (oneDayApart(first, second) || oneDayApart(second, first)) {
        found.push([first.index, problem('KC-3', first.record, '/inForceTo', `leaves one day between it and ${second.key}: inForceTo is the first day no longer in force, so enter the source's last day plus one, the day the next edition begins.`)])
      }
    }
  }
  return found
}

function exampleProblems(record: ProposedRecord): Problem[] {
  const tables: [DecisionTable | null, string][] =
    record.type === 'ruleset'
      ? [[record.values.body.kind === 'table' ? record.values.body.payload : null, '/values/body/payload']]
      : record.type === 'edition'
        ? [
            [record.transition, '/transition'],
            [record.appliesWhen, '/appliesWhen'],
          ]
        : []
  return tables.flatMap(([table, pointer]) => {
    const failing = table ? failingExamples(table) : []
    return failing.length === 0
      ? []
      : [problem('KC-5', record, pointer, `examples ${failing.map((failure) => failure.index).join(', ')} do not hold on the evaluator.`)]
  })
}

/** The territories a record names, which must exist. */
export function namedTerritories(record: ProposedRecord): string[] {
  return namedTerritoryFields(record).map(([territoryId]) => territoryId)
}

function namedTerritoryFields(record: ProposedRecord): [string, string][] {
  const each = (ids: readonly string[], at: string): [string, string][] => ids.map((id, i) => [id, `${at}/${i}`])
  if (record.type === 'territory') {
    return record.parents.map((parent, i): [string, string] => [parent.id, `/parents/${i}/id`])
  }
  if (record.type === 'authority') return [[record.seatTerritoryId, '/seatTerritoryId'], ...each(record.competenceTerritoryIds, '/competenceTerritoryIds')]
  if (record.type === 'work') {
    return [
      ...each(record.territoryIds, '/territoryIds'),
      ...record.addressees.map((addressee, i): [string, string] => [addressee.territoryId, `/addressees/${i}/territoryId`]),
    ]
  }
  if (record.type === 'ruleset') return each(record.values.territoryIds, '/values/territoryIds')
  if (record.type === 'source') return [[record.territoryId, '/territoryId']]
  return []
}

/** The field a reference is named by, for the pointer. */
const REFERENCE_FIELD: Readonly<Record<string, string>> = { edition: '/workKey', manifestation: '/editionKey', work: '/addressees', ruleset: '/values/workIds' }

/**
 * What a record claims to be, which one of its quotes must name: a territory's
 * or an authority's name, a work's designation (else its title), an edition's
 * label as the masthead prints it. A manifestation and a ruleset name nothing
 * a page prints by that name; their quotes are held to the length alone.
 */
export function claimedLabel(record: ProposedRecord): string | null {
  if (record.type === 'territory' || record.type === 'authority') return record.name
  if (record.type === 'work') return record.designation ?? record.title
  if (record.type === 'edition') return record.label
  return null
}

/** KC-6: the record cites a capture of its request, every quote is in that capture, and one names what the record claims. */
export function citationProblems(record: ProposedRecord, captures: ReadonlyMap<string, KnownCapture>): Problem[] {
  const problems: Problem[] = []
  if (!record.citations.some((citation) => citation.captureId)) {
    problems.push(problem('KC-6', record, '/citations', 'cites no capture; a platform record is proposed only with a captured source.'))
  }
  record.citations.forEach((citation, i) => problems.push(...quoteProblems(record, citation, i, captures)))
  const label = claimedLabel(record)
  const quoted = record.citations.flatMap((citation) => (citation.captureId && citation.quote ? [normalizeForQuote(citation.quote)] : []))
  if (label && quoted.length > 0 && !quoted.some((quote) => quote.includes(normalizeForQuote(label)))) {
    problems.push(problem('KC-6', record, '/citations', `no quote names "${label}", which the record claims; quote the words that do.`))
  }
  return problems
}

function quoteProblems(
  record: ProposedRecord,
  citation: ProposedRecord['citations'][number],
  i: number,
  captures: ReadonlyMap<string, KnownCapture>,
): Problem[] {
  if (!citation.captureId) {
    return citation.url ? [problem('KC-6', record, `/citations/${i}/url`, `${citation.url} is not captured; cite a capture instead of a bare link.`)] : []
  }
  const capture = captures.get(citation.captureId)
  if (!capture) return [problem('KC-6', record, `/citations/${i}/captureId`, `${citation.captureId} is no capture of this change request.`)]
  if (!citation.quote) return [problem('KC-6', record, `/citations/${i}/quote`, 'quotes nothing; give the words in the capture that support the record.')]
  if (!quoteLongEnough(citation.quote)) {
    return [problem('KC-6', record, `/citations/${i}/quote`, 'the quote is too short to show anything; quote at least three words or fifteen characters.')]
  }
  if (capture.text === null) {
    return [problem('KC-6', record, `/citations/${i}/captureId`, 'the capture holds no text to check the quote in; capture a text page or paste its text.')]
  }
  if (!quoteFound(citation.quote, capture.text)) {
    return [problem('KC-6', record, `/citations/${i}/quote`, 'the quote is not in the capture; copy it exactly as the captured page has it.')]
  }
  return []
}

export function validateProposal(
  records: readonly ProposedRecord[],
  countryId: string,
  known: ReadonlyMap<string, KnownRecord>,
  captures: ReadonlyMap<string, KnownCapture>,
  existing: readonly DatedPlatformEdition[] = [],
  checkedOutside: ReadonlyMap<string, readonly Problem[]> = new Map(),
): Problem[] {
  const batch = new Map<string, KnowledgeRecordType>()
  const problems: Problem[][] = records.map(() => [])
  records.forEach((record, index) => {
    const id = recordIdOf(record)
    const own = problems[index] as Problem[]
    if (batch.has(id)) own.push(problem('KC-1', record, '', `${id} is proposed twice in one batch.`))
    batch.set(id, record.type)
    const existingRecord = known.get(id)
    if (existingRecord && existingRecord.type !== record.type) {
      own.push(problem('KC-1', record, '/type', `${id} exists as a ${existingRecord.type}; a record keeps its type.`))
    }
    if (existingRecord && existingRecord.countryId !== countryId) {
      own.push(problem('KC-1', record, '', `${id} belongs to ${existingRecord.countryId}; propose it in a request for that country.`))
    }
    if (record.type === 'territory' && record.kind !== 'union' && territoryCountry(record.id) !== countryId) {
      own.push(problem('KC-1', record, '/id', `${record.id} lies outside ${countryId}, the country of this request.`))
    }
    if (record.type === 'source' && territoryCountry(record.territoryId) !== countryId) {
      own.push(problem('KC-1', record, '/territoryId', `${record.territoryId} lies outside ${countryId}, the country of this request.`))
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
    own.push(...intervalProblems(record), ...exampleProblems(record), ...citationProblems(record, captures))
    if (checkedOutsideKit(record)) own.push(...(checkedOutside.get(recordIdOf(record)) ?? [uncheckedProblem(record)]))
  })
  for (const [index, found] of overlapProblems(records, existing)) problems[index]?.push(found)
  return problems.flatMap((own, index) => own.map((found) => ({ ...found, index })))
}
