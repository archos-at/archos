/**
 * The validation kit's first checks (ADR-0165, design §4.6), run on every
 * proposal and again on submit: a proposal that fails one is not written. Pure.
 *
 * - KC-1: every record a proposal names exists (in the batch or released or
 *   drafted on the platform) with the type it must have; a record keeps its
 *   type and its country; a territory belongs to the request's country; no
 *   record is proposed twice in one batch.
 * - KC-3: intervals are ordered.
 *
 * The rest of the kit (anchors, quote spans, hosts, level obligations,
 * instruction-like text) needs sources and rulesets that arrive later; until
 * then a reviewer checks those claim by claim.
 */

import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { proposalKey, recordIdOf, referencesOf } from './records'
import type { ProposedRecord } from './wire'

/** A platform record that already exists: its type and country. */
export interface KnownRecord {
  type: KnowledgeRecordType
  countryId: string
}

export interface Problem {
  check: 'KC-1' | 'KC-3'
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

/** The territories a record names, which must exist. */
export function namedTerritories(record: ProposedRecord): string[] {
  if (record.type === 'territory') return [...record.parentIds, ...record.datedParents.map((parent) => parent.id)]
  if (record.type === 'authority') return [record.seatTerritoryId, ...record.competenceTerritoryIds]
  if (record.type === 'work') return [...record.territoryIds, ...record.addressees.map((addressee) => addressee.territoryId)]
  return []
}

export function validateProposal(
  records: readonly ProposedRecord[],
  countryId: string,
  known: ReadonlyMap<string, KnownRecord>,
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
    problems.push(...intervalProblems(record))
  }
  return problems
}
