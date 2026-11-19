import type { LicenceClass } from '@/lib/db/schema/knowledge-records'
import type { OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { ASK_FOR_LICENCE, UNKNOWN_EDITION, type Addressee, type EntryValues } from '../wire'

export interface DocumentReading {
  fileName: string
  title?: string | null
  summary?: string | null
  documentType?: string | null
  federalState?: string | null
}

export type SubdivisionTerritories = Readonly<Record<string, string>>

const KNOWN_AUTHORITIES: readonly { pattern: RegExp; addressee: Addressee }[] = [
  { pattern: /\bMA\s?37\b|Baupolizei\s+Wien/i, addressee: { name: 'MA 37', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?19\b/i, addressee: { name: 'MA 19', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?21\b/i, addressee: { name: 'MA 21', territoryId: 'AT-9' } },
  { pattern: /\bMA\s?64\b/i, addressee: { name: 'MA 64', territoryId: 'AT-9' } },
]

const DESIGNATION =
  /(?<![\p{L}\d])(ÖNORM|ONORM|OENORM|DIN|EN|ISO|SIA|OIB[- ](?:Richtlinie|RL))\s*((?:EN\s+|ISO\s+)*[A-Z]?\s?\d+(?:[-.]\d+)*)(?:\s*[:]\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?))?/iu

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

const BARE_STANDARD_NUMBER = /^([AB])[ _-]?(\d{4}(?:-\d+)*)(?=[ _.-]|$)/i
const DATE_SHAPED = /^(19|20)\d{2}(?:-(0[1-9]|1[0-2])(?:-\d{2})?)?$/
const DIRECTIVE = /\bWeisung|Erlass|Rundschreiben|Dienstanweisung/i
const COMMENTARY = /\bKommentar|Kommentierung|Erläuterungen\s+zu|commentary/i
const GUIDELINE = /\bLeitfaden|Richtlinie|Merkblatt|guideline|\bRVS\b/i
const LAW = /\b(Bauordnung|Gesetz|Verordnung|Bautechnikverordnung|BauO|LGBl|BGBl)\b/i

function heldByPlatform(designation: Designation | null): boolean {
  return designation?.prefix === 'OIB-Richtlinie'
}

export type NormRecognition = { norm: false; platformHeld: boolean } | { norm: true; designation: string | null }

export function recognizeNorm(reading: DocumentReading): NormRecognition {
  const text = haystack(reading)
  const designation = readDesignation(text)
  if (heldByPlatform(designation)) return { norm: false, platformHeld: true }
  if (designation) return { norm: true, designation: designation.designation }
  const bare = BARE_STANDARD_NUMBER.exec(reading.fileName)
  if (bare && !DATE_SHAPED.test(bare[2])) return { norm: true, designation: `ÖNORM ${bare[1].toUpperCase()} ${bare[2]}` }
  if (DIRECTIVE.test(text) || GUIDELINE.test(text) || (COMMENTARY.test(text) && LAW.test(text))) return { norm: true, designation: null }
  return { norm: false, platformHeld: false }
}

export function readKind(text: string, designation: Designation | null): OfficeWorkKind {
  if (DIRECTIVE.test(text)) return 'authority_directive'
  if (COMMENTARY.test(text)) return 'commentary'
  if (heldByPlatform(designation) || GUIDELINE.test(text)) {
    return designation && !heldByPlatform(designation) ? 'technical_standard' : 'guideline'
  }
  if (designation) return 'technical_standard'
  if (LAW.test(text)) return 'statute'
  return 'technical_standard'
}

export function defaultLicence(kind: OfficeWorkKind, askForLicence: boolean = ASK_FOR_LICENCE): LicenceClass {
  if (!askForLicence) return 'public_open'
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

function readTerritories(kind: OfficeWorkKind, reading: DocumentReading, addressees: Addressee[], subdivisions: SubdivisionTerritories): string[] {
  if (kind === 'technical_standard' || kind === 'commentary') return []
  const fromAuthorities = addressees.map((addressee) => addressee.territoryId)
  const fromReading = reading.federalState ? subdivisions[reading.federalState] : undefined
  return [...new Set([...fromAuthorities, ...(fromReading ? [fromReading] : [])])]
}

function issuerOf(designation: Designation | null, addressees: Addressee[]): string | null {
  if (designation) return ISSUERS.find(([pattern]) => pattern.test(designation.prefix))?.[1] ?? null
  return addressees[0]?.name ?? null
}

export function proposeFromReading(reading: DocumentReading, subdivisions: SubdivisionTerritories): EntryValues {
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
    editionLabel: edition.label ?? UNKNOWN_EDITION,
    issuedOn: edition.issuedOn,
    inForceFrom: null,
    inForceTo: null,
    territoryIds: readTerritories(kind, reading, addressees, subdivisions),
    issuer: issuerOf(designation, addressees),
    addressees,
    licenceClass: defaultLicence(kind),
  }
}
