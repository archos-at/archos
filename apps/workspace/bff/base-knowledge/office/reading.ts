/**
 * What a base-knowledge document's name and masthead say (ADR-0163): kind,
 * designation, edition, territory, issuer and, for a directive, the authority.
 * Pure; nothing here calls a model. Today the service passes the file name
 * alone: the copy's text is held until a person confirms it, so no summary or
 * search projection of it may feed the proposal. `title` and `summary` stay for
 * a masthead read that the licensed seam can make without retaining the text.
 *
 * A proposal, never a decision: the person confirms or corrects every value,
 * and an agent that read the masthead itself proposes through the same
 * operation with its own values, which win over these.
 */

import type { LicenceClass } from '@/lib/db/schema/knowledge-records'
import type { OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import type { Addressee, EntryValues } from '../wire'

export interface DocumentReading {
  fileName: string
  title?: string | null
  summary?: string | null
  documentType?: string | null
  /** The search projection's federal state token of the document (`vienna`), when it read one. */
  federalState?: string | null
}

/** The intake's `federal_state` tokens as ISO 3166-2 codes. */
export const FEDERAL_STATE_TERRITORIES: Readonly<Record<string, string>> = {
  burgenland: 'AT-1',
  carinthia: 'AT-2',
  lower_austria: 'AT-3',
  upper_austria: 'AT-4',
  salzburg: 'AT-5',
  styria: 'AT-6',
  tyrol: 'AT-7',
  vorarlberg: 'AT-8',
  vienna: 'AT-9',
}

/** Authorities a directive names, with the territory they decide for (the interim path, design §8.1). */
const KNOWN_AUTHORITIES: readonly { pattern: RegExp; addressee: Addressee }[] = [
  { pattern: /\bMA\s?37\b|Baupolizei\s+Wien/i, addressee: { name: 'MA 37', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?19\b/i, addressee: { name: 'MA 19', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?21\b/i, addressee: { name: 'MA 21', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?64\b/i, addressee: { name: 'MA 64', territoryId: 'AT-9' } },
]

/** ÖNORM B 1600, ÖNORM EN 1991-1-1, DIN 4109-1, DIN EN 1992, OIB-Richtlinie 2, with an edition when printed. */
const DESIGNATION =
  /(?<![\p{L}\d])(ÖNORM|ONORM|OENORM|DIN|EN|ISO|SIA|OIB[- ]Richtlinie)\s*((?:EN\s+|ISO\s+)*[A-Z]?\s?\d+(?:[-.]\d+)*)(?:\s*[:]\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?))?/iu

const ISO_DATE = /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/
const YEAR = /\b(19|20)\d{2}\b/

const ISSUERS: readonly [RegExp, string][] = [
  [/^Ö?O?E?NORM$/i, 'Austrian Standards'],
  [/^DIN$/i, 'DIN'],
  [/^EN$/i, 'CEN'],
  [/^ISO$/i, 'ISO'],
  [/^SIA$/i, 'SIA'],
  [/^OIB/i, 'OIB'],
]

function haystack(reading: DocumentReading): string {
  return [reading.title, reading.fileName.replace(/[_]+/g, ' ').replace(/\.[a-z0-9]{2,5}$/i, ''), reading.summary]
    .filter(Boolean)
    .join('\n')
}

function prefixOf(raw: string): string {
  const upper = raw.toUpperCase()
  if (upper === 'ONORM' || upper === 'OENORM' || upper === 'ÖNORM') return 'ÖNORM'
  if (upper.startsWith('OIB')) return 'OIB-Richtlinie'
  return upper
}

interface Designation {
  designation: string
  prefix: string
  edition: string | null
}

export function readDesignation(text: string): Designation | null {
  const match = DESIGNATION.exec(text)
  if (!match) return null
  const prefix = prefixOf(match[1])
  const number = match[2].replace(/\s+/g, ' ').trim()
  const edition = match[3] ?? null
  const base = `${prefix} ${number}`
  return { designation: edition ? `${base}:${edition.slice(0, 4)}` : base, prefix, edition }
}

export function readKind(text: string, designation: Designation | null): OfficeWorkKind {
  if (/\bWeisung|Erlass|Rundschreiben|Dienstanweisung/i.test(text)) return 'authority_directive'
  if (/\bKommentar|Kommentierung|Erläuterungen\s+zu|commentary/i.test(text)) return 'commentary'
  if (designation?.prefix === 'OIB-Richtlinie' || /\bLeitfaden|Richtlinie|Merkblatt|guideline/i.test(text)) {
    return designation && designation.prefix !== 'OIB-Richtlinie' ? 'technical_standard' : 'guideline'
  }
  if (designation) return 'technical_standard'
  if (/\b(Bauordnung|Gesetz|Verordnung|Bautechnikverordnung|BauO|LGBl|BGBl)\b/i.test(text)) return 'statute'
  return 'technical_standard'
}

/** Standards and commentaries are bought; a directive or a law is published by its author. */
export function defaultLicence(kind: OfficeWorkKind): LicenceClass {
  return kind === 'authority_directive' || kind === 'statute' ? 'public_open' : 'licensed'
}

function readEdition(text: string, designation: Designation | null): { label: string | null; issuedOn: string | null } {
  const date = ISO_DATE.exec(text)?.[0] ?? null
  if (designation?.edition && designation.edition.length === 10) return { label: designation.edition, issuedOn: designation.edition }
  if (designation?.edition) return { label: designation.edition, issuedOn: date }
  if (date) return { label: date, issuedOn: date }
  const year = YEAR.exec(text)?.[0] ?? null
  return { label: year, issuedOn: null }
}

function readAddressees(text: string): Addressee[] {
  return KNOWN_AUTHORITIES.filter(({ pattern }) => pattern.test(text)).map(({ addressee }) => addressee)
}

function readTerritories(kind: OfficeWorkKind, reading: DocumentReading, addressees: Addressee[]): string[] {
  if (kind === 'technical_standard' || kind === 'commentary') return []
  const fromAuthorities = addressees.map((addressee) => addressee.territoryId)
  const fromReading = reading.federalState ? FEDERAL_STATE_TERRITORIES[reading.federalState] : undefined
  return [...new Set([...fromAuthorities, ...(fromReading ? [fromReading] : [])])]
}

function issuerOf(designation: Designation | null, addressees: Addressee[]): string | null {
  if (designation) return ISSUERS.find(([pattern]) => pattern.test(designation.prefix))?.[1] ?? null
  return addressees[0]?.name ?? null
}

/** Every value the reading can propose; the caller's own values replace these one by one. */
export function proposeFromReading(reading: DocumentReading): EntryValues {
  const text = haystack(reading)
  const designation = readDesignation(text)
  const kind = readKind(text, designation)
  const addressees = kind === 'authority_directive' ? readAddressees(text) : []
  const edition = readEdition(text, designation)
  const title = (reading.title?.trim() || reading.fileName.replace(/\.[a-z0-9]{2,5}$/i, '')).slice(0, 300)
  return {
    kind,
    title,
    designation: designation?.designation ?? null,
    editionLabel: edition.label ?? 'unbekannt',
    issuedOn: edition.issuedOn,
    territoryIds: readTerritories(kind, reading, addressees),
    issuer: issuerOf(designation, addressees),
    addressees,
    licenceClass: defaultLicence(kind),
  }
}
