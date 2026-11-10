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
    case 'work':
      return record.addressees.flatMap((addressee) =>
        addressee.authorityKey
          ? [{ id: `authority:${addressee.authorityKey}`, type: 'authority' as const }]
          : []
      )
    case 'ruleset':
      return [
        ...record.values.workIds.map((id) => ({ id, type: 'work' as const })),
        ...(record.values.basisEditionId
          ? [{ id: record.values.basisEditionId, type: 'edition' as const }]
          : []),
      ]
    default:
      return []
  }
}

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
        aliases: record.aliases,
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
const NOT_CLAIMS = new Set([
  'revisionId',
  'recordId',
  'organizationId',
  'terms',
  'sha256',
  'textStatus',
])

/** The claims of a stored body: every column a reviewer accepts, edits or rejects. */
export function claimsOf(body: Record<string, unknown>): { path: string; value: unknown }[] {
  return Object.entries(body)
    .filter(([path]) => !NOT_CLAIMS.has(path))
    .map(([path, value]) => ({ path, value }))
}
