/**
 * The validation kit's first checks (ADR-0165, design §4.6), run on every
 * proposal and again on submit: a proposal that fails one is not written. Pure.
 *
 * - KC-1: every record a proposal names exists (in the batch or released or
 *   drafted on the platform) with the type it must have; a record keeps its
 *   type and its country; a territory belongs to the request's country; no
 *   record is proposed twice in one batch.
 * - KC-3: intervals are ordered, and no two editions of one work are in force
 *   on the same day: two in one batch, or a new one beside one already on the
 *   platform (the as-of resolver refuses that as ambiguous, so it is refused
 *   here first).
 * - KC-5: a ruleset's and a transition's own examples hold on the evaluator.
 *
 * The rest of the kit (anchors, quote spans, hosts, level obligations,
 * instruction-like text) needs sources and rulesets that arrive later; until
 * then a reviewer checks those claim by claim.
 */

import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { failingExamples } from '../rulesets/decision-table'
import { proposalKey, recordIdOf, referencesOf } from './records'
import type { ProposedRecord } from './wire'

/** A platform record that already exists: its type and country. */
export interface KnownRecord {
  type: KnowledgeRecordType
  countryId: string
}

export interface Problem {
  check: 'KC-1' | 'KC-3' | 'KC-5'
  /** The proposal's key (or a territory's id) the problem is about. */
  key: string
  detail: string
}

function territoryCountry(territoryId: string): string {
  return territoryId.slice(0, 2)
}

function intervalProblems(record: ProposedRecord): Problem[] {
  const key = proposalKey(record)
  if (record.type === 'edition' && record.inForceFrom && record.inForceTo && record.inForceTo < record.inForceFrom) {
    return [{ check: 'KC-3', key, detail: 'inForceTo lies before inForceFrom.' }]
  }
  if ((record.type === 'territory' || record.type === 'relation') && record.validFrom && record.validTo && record.validTo <= record.validFrom) {
    return [{ check: 'KC-3', key, detail: 'validTo must lie after validFrom (intervals are half-open).' }]
  }
  if (record.type === 'territory') {
    const reversed = record.datedParents.find((parent) => parent.validFrom && parent.validTo && parent.validTo <= parent.validFrom)
    if (reversed) return [{ check: 'KC-3', key, detail: `the interval of parent ${reversed.id} is empty or reversed.` }]
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

const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string | null }) =>
  a.from <= (b.to ?? '9999-12-31') && b.from <= (a.to ?? '9999-12-31')

/**
 * Editions of one work in force on the same day (`inForceTo` is inclusive):
 * two proposed in one batch, or one proposed beside one already on the
 * platform. A batch that re-proposes the existing edition (closing its
 * `inForceTo`) is compared against its new dates, not its old ones.
 */
function overlapProblems(records: readonly ProposedRecord[], existing: readonly DatedPlatformEdition[]): Problem[] {
  const proposed = records.flatMap((record) =>
    record.type === 'edition' && record.inForceFrom
      ? [{ id: recordIdOf(record), key: record.key, workId: `work:${record.workKey}`, from: record.inForceFrom, to: record.inForceTo }]
      : [],
  )
  const inBatch = new Set(records.map(recordIdOf))
  const others = existing.flatMap((edition) =>
    edition.inForceFrom && !inBatch.has(edition.id)
      ? [{ id: edition.id, key: edition.id, workId: edition.workId, from: edition.inForceFrom, to: edition.inForceTo }]
      : [],
  )
  const problems: Problem[] = []
  for (const [index, first] of proposed.entries()) {
    for (const second of [...proposed.slice(index + 1), ...others]) {
      if (first.workId !== second.workId || !overlaps(first, second)) continue
      problems.push({ check: 'KC-3', key: first.key, detail: `is in force on days ${second.key} is; end one before the other begins.` })
    }
  }
  return problems
}

function exampleProblems(record: ProposedRecord): Problem[] {
  const table =
    record.type === 'ruleset' && record.values.body.kind === 'table'
      ? record.values.body.payload
      : record.type === 'edition'
        ? record.transition
        : null
  if (!table) return []
  const failing = failingExamples(table)
  if (failing.length === 0) return []
  return [{ check: 'KC-5', key: proposalKey(record), detail: `examples ${failing.map((failure) => failure.index).join(', ')} do not hold on the evaluator.` }]
}

/** The territories a record names, which must exist. */
export function namedTerritories(record: ProposedRecord): string[] {
  if (record.type === 'territory') return [...record.parentIds, ...record.datedParents.map((parent) => parent.id)]
  if (record.type === 'authority') return [record.seatTerritoryId, ...record.competenceTerritoryIds]
  if (record.type === 'work') return [...record.territoryIds, ...record.addressees.map((addressee) => addressee.territoryId)]
  if (record.type === 'ruleset') return record.values.territoryIds
  return []
}

export function validateProposal(
  records: readonly ProposedRecord[],
  countryId: string,
  known: ReadonlyMap<string, KnownRecord>,
  existing: readonly DatedPlatformEdition[] = [],
): Problem[] {
  const batch = new Map<string, KnowledgeRecordType>()
  const problems: Problem[] = []
  for (const record of records) {
    const id = recordIdOf(record)
    const key = proposalKey(record)
    if (batch.has(id)) problems.push({ check: 'KC-1', key, detail: `${id} is proposed twice in one batch.` })
    batch.set(id, record.type)
    const existing = known.get(id)
    if (existing && existing.type !== record.type) {
      problems.push({ check: 'KC-1', key, detail: `${id} exists as a ${existing.type}; a record keeps its type.` })
    }
    if (existing && existing.countryId !== countryId) {
      problems.push({ check: 'KC-1', key, detail: `${id} belongs to ${existing.countryId}; propose it in a request for that country.` })
    }
    if (record.type === 'territory' && record.kind !== 'union' && territoryCountry(record.id) !== countryId) {
      problems.push({ check: 'KC-1', key, detail: `${record.id} lies outside ${countryId}, the country of this request.` })
    }
  }
  const exists = (id: string, type: KnowledgeRecordType) => batch.get(id) === type || known.get(id)?.type === type
  for (const record of records) {
    const key = proposalKey(record)
    for (const reference of referencesOf(record)) {
      if (!exists(reference.id, reference.type)) {
        problems.push({ check: 'KC-1', key, detail: `names ${reference.id}, which is no ${reference.type} on the platform or in this batch.` })
      }
    }
    for (const territoryId of namedTerritories(record)) {
      if (!exists(territoryId, 'territory')) {
        problems.push({ check: 'KC-1', key, detail: `names territory ${territoryId}, which is not imported; import it first.` })
      }
    }
    problems.push(...intervalProblems(record), ...exampleProblems(record))
  }
  return [...problems, ...overlapProblems(records, existing)]
}
