/**
 * A change request's claims as a reviewer reads them (ADR-0165): each field
 * under its own name, each value in words. A territory is its name with its
 * code beside it (Wien, AT-9), a kind is the kind in the reviewer's language,
 * a list is a list. The record ids and column names stay out of sight: they are
 * the machine's, not the person's. Pure.
 */

import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'

/** Subdivisions by territory code (Wien, AT-9), from the records' list: what a reviewer recognises. */
const SUBDIVISIONS: ReadonlyMap<string, string> = new Map(SITE_SUBDIVISIONS.options.map((option) => [option.territoryId, option.label]))

/** A country's name in `locale` (`AT` → Österreich), or the code when the runtime does not know it. */
export function countryName(countryId: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryId) ?? countryId
  } catch {
    return countryId
  }
}

/** A territory's name when it is one a reviewer would recognise by name, else null. */
export function territoryName(territoryId: string, locale: string): string | null {
  const subdivision = SUBDIVISIONS.get(territoryId)
  if (subdivision) return subdivision
  if (/^[A-Z]{2}$/.test(territoryId)) {
    const name = countryName(territoryId, locale)
    return name === territoryId ? null : name
  }
  return null
}

/** The fields a reviewer is shown, in the order they read best; anything else follows. */
export const CLAIM_FIELDS = [
  'name',
  'title',
  'kind',
  'identifiers',
  'label',
  'issuer',
  'competenceTerritoryIds',
  'seatTerritoryId',
  'functionCodes',
  'territoryIds',
  'addressees',
  'parentIds',
  'issuedOn',
  'inForceFrom',
  'inForceTo',
  'validFrom',
  'validTo',
  'workId',
  'editionId',
  'form',
  'language',
  'licenceClass',
  'corpusFile',
  'aliases',
] as const
export type ClaimField = (typeof CLAIM_FIELDS)[number]

export function isKnownField(path: string): path is ClaimField {
  return (CLAIM_FIELDS as readonly string[]).includes(path)
}

/** Known fields first, in the reading order above. */
export function byReadingOrder<T extends { path: string }>(claims: readonly T[]): T[] {
  const rank = (path: string) => (isKnownField(path) ? CLAIM_FIELDS.indexOf(path) : CLAIM_FIELDS.length)
  return [...claims].sort((a, b) => rank(a.path) - rank(b.path))
}

/** One value as the reviewer sees it: nothing, a line of text, or a list of items. */
export type ShownValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; code?: string }
  | { kind: 'list'; items: { text: string; code?: string }[] }

export interface Wording {
  locale: string
  /** A record or territory kind in words, or null when the vocabulary has no word for it. */
  kindWord: (kind: string) => string | null
  /** An authority's function in words (`building_permit` → Baubewilligung), or null. */
  functionWord: (code: string) => string | null
  /** A licence class in words, or null. */
  licenceWord: (licenceClass: string) => string | null
}

const TERRITORY_FIELDS = new Set(['competenceTerritoryIds', 'seatTerritoryId', 'territoryIds', 'parentIds'])

function territoryItem(id: string, wording: Wording): { text: string; code?: string } {
  const name = territoryName(id, wording.locale)
  return name ? { text: name, code: id } : { text: id }
}

/** `work:oenorm-b-5371` → `oenorm-b-5371`: the key a reviewer proposed, without the type prefix. */
function recordKey(id: string): string {
  return id.replace(/^(work|edition|manifestation|authority):/, '')
}

function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export function showValue(path: string, value: unknown, wording: Wording): ShownValue {
  if (value === null || value === undefined || value === '') return { kind: 'empty' }
  if (Array.isArray(value) && value.length === 0) return { kind: 'empty' }
  if (TERRITORY_FIELDS.has(path)) {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)]
    const items = ids.map((id) => territoryItem(id, wording))
    return items.length === 1 && !Array.isArray(value) ? { kind: 'text', ...items[0] } : { kind: 'list', items }
  }
  if (path === 'kind' && typeof value === 'string') return { kind: 'text', text: wording.kindWord(value) ?? value }
  if (path === 'functionCodes' && Array.isArray(value)) {
    return { kind: 'list', items: value.map((code) => ({ text: wording.functionWord(String(code)) ?? String(code) })) }
  }
  if (path === 'licenceClass' && typeof value === 'string') return { kind: 'text', text: wording.licenceWord(value) ?? value }
  if (path === 'language' && typeof value === 'string') return { kind: 'text', text: languageName(value, wording.locale) }
  if ((path === 'workId' || path === 'editionId') && typeof value === 'string') return { kind: 'text', text: recordKey(value) }
  if (path === 'addressees' && Array.isArray(value)) {
    return {
      kind: 'list',
      items: value.map((entry) => {
        const addressee = entry as { name?: string; territoryId?: string }
        const where = addressee.territoryId ? territoryItem(addressee.territoryId, wording).text : null
        return { text: where ? `${addressee.name ?? '?'} (${where})` : String(addressee.name ?? '?') }
      }),
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined && item !== null)
    if (entries.length === 0) return { kind: 'empty' }
    // `{ designation: "ÖNORM B 5371" }` reads as the designation itself.
    if (entries.length === 1) return { kind: 'text', text: String(entries[0][1]) }
    return { kind: 'list', items: entries.map(([key, item]) => ({ text: `${key}: ${String(item)}` })) }
  }
  if (Array.isArray(value)) return { kind: 'list', items: value.map((item) => ({ text: String(item) })) }
  return { kind: 'text', text: String(value) }
}

/** The name a record is known by: its name, title or label, whichever it has. */
export function recordName(claims: readonly { path: string; value: unknown }[], recordId: string): string {
  for (const path of ['name', 'title', 'label']) {
    const claim = claims.find((entry) => entry.path === path)
    if (claim && typeof claim.value === 'string' && claim.value.trim()) return claim.value
  }
  return recordKey(recordId)
}
