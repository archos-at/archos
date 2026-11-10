/**
 * A proposed platform record as the rows it becomes (ADR-0165): its record id,
 * the records it names, and its typed body. Pure.
 *
 * Ids are stable across proposals, so a batch resent after a repair lands on
 * the same records: `<type>:<key>`, and a territory's own id.
 */

import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { rulesetColumns } from '../rulesets/columns'
import type { ProposedRecord } from './wire'

export function recordIdOf(record: ProposedRecord): string {
  return record.type === 'territory' ? record.id : `${record.type}:${record.key}`
}

/** What a proposal names: the record it is, by key or id. */
export function proposalKey(record: ProposedRecord): string {
  return record.type === 'territory' ? record.id : record.key
}

/** The records a proposal points at, by record id and the type each must have. */
export function referencesOf(record: ProposedRecord): { id: string; type: KnowledgeRecordType }[] {
  switch (record.type) {
    case 'edition':
      return [{ id: `work:${record.workKey}`, type: 'work' }]
    case 'manifestation':
      return [{ id: `edition:${record.editionKey}`, type: 'edition' }]
    case 'relation':
      return [
        { id: `${record.from.type}:${record.from.key}`, type: record.from.type },
        { id: `${record.to.type}:${record.to.key}`, type: record.to.type },
      ]
    case 'work':
      return record.addressees.flatMap((addressee) =>
        addressee.authorityKey ? [{ id: `authority:${addressee.authorityKey}`, type: 'authority' as const }] : [],
      )
    case 'ruleset':
      return [
        ...record.values.workIds.map((id) => ({ id, type: 'work' as const })),
        ...(record.values.basisEditionId ? [{ id: record.values.basisEditionId, type: 'edition' as const }] : []),
      ]
    default:
      return []
  }
}

const isSiteOnly = (factors: readonly string[]): boolean => factors.length === 1 && factors[0] === 'site'

/** The typed body columns of the revision a proposal becomes. */
export function bodyOf(record: ProposedRecord): Record<string, unknown> {
  switch (record.type) {
    case 'work':
      return {
        kind: record.kind,
        title: record.title,
        identifiers: record.designation ? { designation: record.designation } : {},
        territoryIds: record.territoryIds,
        issuer: record.issuer,
        addressees: record.addressees.map(({ name, territoryId, authorityKey }) => ({
          name,
          territoryId,
          ...(authorityKey ? { authorityId: `authority:${authorityKey}` } : {}),
        })),
        historyAvailableFrom: record.historyAvailableFrom,
        // The site alone is the default column value, and no claim of its own (0212).
        ...(isSiteOnly(record.connectsBy) ? {} : { connectsBy: record.connectsBy }),
      }
    case 'edition':
      return {
        workId: `work:${record.workKey}`,
        label: record.label,
        issuedOn: record.issuedOn,
        inForceFrom: record.inForceFrom,
        inForceTo: record.inForceTo,
        transition: record.transition,
      }
    case 'manifestation':
      return {
        editionId: `edition:${record.editionKey}`,
        form: record.form,
        language: record.language,
        licenceClass: record.licenceClass,
        corpusFile: record.corpusFile,
      }
    case 'territory':
      return {
        kind: record.kind,
        name: record.name,
        parentIds: record.parentIds,
        datedParents: record.datedParents,
        aliases: record.aliases,
        validFrom: record.validFrom,
        validTo: record.validTo,
        // Only a stated coverage is a claim a reviewer decides; unstated inherits (0212).
        ...(record.coverageLevel === null ? {} : { coverageLevel: record.coverageLevel }),
        ...(record.municipalLaw === null ? {} : { municipalLaw: record.municipalLaw }),
      }
    case 'relation':
      return {
        relationType: record.relationType,
        mode: record.mode,
        fromId: `${record.from.type}:${record.from.key}`,
        fromType: record.from.type,
        toId: `${record.to.type}:${record.to.key}`,
        toType: record.to.type,
        anchors: record.anchors,
        provision: record.provision,
        validFrom: record.validFrom,
        validTo: record.validTo,
      }
    case 'ruleset':
      return rulesetColumns(record.values)
    case 'authority':
      return {
        name: record.name,
        functionCodes: record.functionCodes,
        seatTerritoryId: record.seatTerritoryId,
        competenceTerritoryIds: record.competenceTerritoryIds,
        identifiers: record.identifiers,
      }
  }
}

/** Body columns that are no claim a reviewer decides: keys and the copy's licence statements. */
const NOT_CLAIMS = new Set(['revisionId', 'recordId', 'organizationId', 'terms', 'sha256', 'textStatus'])

/** A column 0212 added, left at what it says when nobody stated it: no claim, so older proposals review as they did. */
function unstated(path: string, value: unknown): boolean {
  if (path === 'coverageLevel' || path === 'municipalLaw') return value === null || value === undefined
  if (path === 'connectsBy') return Array.isArray(value) && isSiteOnly(value as string[])
  return false
}

/** The claims of a stored body: every column a reviewer accepts, edits or rejects. */
export function claimsOf(body: Record<string, unknown>): { path: string; value: unknown }[] {
  return Object.entries(body)
    .filter(([path]) => !NOT_CLAIMS.has(path))
    .filter(([path, value]) => !unstated(path, value))
    .map(([path, value]) => ({ path, value }))
}
