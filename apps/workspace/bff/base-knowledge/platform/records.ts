/**
 * A proposed platform record as the rows it becomes (ADR-0165): its record id,
 * the records it names, and its typed body. Pure.
 *
 * Ids are stable across proposals, so a batch resent after a repair lands on
 * the same records: `<type>:<key>`, and a territory's own id.
 */

import { createHash } from 'node:crypto'
import type { KnowledgeRecordType } from '@/lib/base-knowledge/wire/vocab'
import { sourceConfigOf } from '@/lib/base-knowledge/wire/source'
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
    case 'golden_case':
      return record.expected.edition ? [{ id: `edition:${record.expected.edition.editionKey}`, type: 'edition' }] : []
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
        identifiers: { ...record.identifiers, ...(record.designation ? { designation: record.designation } : {}) },
        territoryIds: record.territoryIds,
        issuer: record.issuer,
        addressees: record.addressees.map(({ name, territoryId, authorityKey }) => ({
          name,
          territoryId,
          ...(authorityKey ? { authorityId: `authority:${authorityKey}` } : {}),
        })),
        historyAvailableFrom: record.historyAvailableFrom,
        // A class nobody stated is no claim (0237), so a work proposed before it reviews as it did.
        ...(record.docClass ? { docClass: record.docClass } : {}),
        // The site alone is the default column value, and no claim of its own (0213).
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
        appliesWhen: record.appliesWhen,
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
        parents: record.parents,
        // For builds before 0219 only, derived from `parents` and never a claim of their own.
        parentIds: record.parents.filter((parent) => !parent.validFrom && !parent.validTo).map((parent) => parent.id),
        datedParents: record.parents.filter((parent) => parent.validFrom || parent.validTo),
        aliases: record.aliases,
        validFrom: record.validFrom,
        validTo: record.validTo,
        // Only a stated coverage is a claim a reviewer decides; unstated inherits (0213).
        ...(record.coverageLevel === null ? {} : { coverageLevel: record.coverageLevel }),
        ...(record.municipalLaw === null ? {} : { municipalLaw: record.municipalLaw }),
        // Only a stated zone is a claim; unstated inherits from the parent (0235).
        ...(record.zone === null ? {} : { zone: record.zone }),
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
    case 'source':
      return {
        title: record.title,
        territoryId: record.territoryId,
        protocol: record.protocol,
        format: record.format,
        hosts: record.hosts,
        dataFlow: record.dataFlow,
        monitorKind: record.monitor.kind,
        monitorIntervalHours: record.monitor.intervalHours,
        licence: record.terms.licence,
        config: sourceConfigOf(record),
      }
    case 'golden_case':
      return {
        question: record.question,
        language: record.language,
        context: record.context,
        expected: record.expected,
        mustNot: record.mustNot,
        tags: record.tags,
      }
  }
}

/** Body columns that are no claim a reviewer decides: keys and the copy's licence statements. */
const NOT_CLAIMS = new Set(['revisionId', 'recordId', 'organizationId', 'terms', 'sha256', 'textStatus', 'parentIds', 'datedParents'])

/** A column 0213, 0235 or 0237 added, left at what it says when nobody stated it: no claim, so older proposals review as they did. */
function unstated(path: string, value: unknown): boolean {
  if (path === 'coverageLevel' || path === 'municipalLaw' || path === 'zone' || path === 'docClass') return value === null || value === undefined
  if (path === 'connectsBy') return Array.isArray(value) && isSiteOnly(value as string[])
  return false
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A source's configuration as a reviewer reads it: a recorded response carried
 * as base64 (a `pdf_document` source's PDF) shows its type, size and sha256 in
 * place of the bytes. Nobody reviews base64, and the bytes would fill the view
 * an agent reads past the door's result cap; the record keeps them whole.
 */
function reviewedConfig(config: unknown): unknown {
  if (!isObject(config) || !Array.isArray(config.fixtures)) return config
  const digest = (response: unknown) => {
    if (!isObject(response) || response.encoding !== 'base64' || typeof response.text !== 'string') return response
    const bytes = Buffer.from(response.text, 'base64')
    return { content_type: response.content_type, encoding: 'base64', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const fixtures = config.fixtures.map((fixture: unknown) =>
    isObject(fixture) && isObject(fixture.responses)
      ? { ...fixture, responses: Object.fromEntries(Object.entries(fixture.responses).map(([url, response]) => [url, digest(response)])) }
      : fixture,
  )
  return { ...config, fixtures }
}

/** The claims of a stored body: every column a reviewer accepts, edits or rejects, as the reviewer reads it. */
export function claimsOf(body: Record<string, unknown>): { path: string; value: unknown }[] {
  return Object.entries(body)
    .filter(([path]) => !NOT_CLAIMS.has(path))
    .filter(([path, value]) => !unstated(path, value))
    .map(([path, value]) => ({ path, value: path === 'config' ? reviewedConfig(value) : value }))
}
