import { SHELVES, SOURCE_KINDS } from '@/shared/vocabularies.generated'
import { PRODUCT_NAME } from '@/lib/brand'

export type SourceSignal = 'law' | 'project' | 'office' | 'auto' | 'model'

export type SourceTint = SourceSignal | 'oib'

export type SourceKind = (typeof SOURCE_KINDS)[number]

const SOURCE_KIND_SET: ReadonlySet<string> = new Set<string>(SOURCE_KINDS)

export const LEGACY_LANE: Readonly<Record<string, string>> = {
  baurecht: 'building_law',
  baurecht_oib: 'building_law_oib',
  baurecht_oib_leitfaden: 'building_law_oib_guide',
  baurecht_oib_erlaeuterung: 'building_law_oib_explanatory_note',
  baurecht_oib_begriffe: 'building_law_oib_definitions',
  baurecht_oib_referenz: 'building_law_oib_reference',
  baurecht_oib_diff: 'building_law_oib_amendment',
  baurecht_ris: 'building_law_ris',
  baurecht_basis: 'building_law_base',
  baurecht_bund: 'building_law_federal',
  baurecht_land: 'building_law_state',
  baurecht_verordnung: 'building_law_ordinance',
  behoerde: 'authority',
  norm_extern: 'external_standard',
  buero: 'office',
  buero_piloti: 'office_piloti',
  projekt: 'project',
  messung: 'measurement',
}

export const modernizeLane = (value: string | null | undefined): string | null | undefined => {
  if (!value) return value
  const key = value.trim().toLowerCase()
  return Object.hasOwn(LEGACY_LANE, key) ? LEGACY_LANE[key] : value
}

export const asSourceKind = (value: string | null | undefined): SourceKind | undefined =>
  value && SOURCE_KIND_SET.has(value) ? (value as SourceKind) : undefined

export const KIND_TO_SIGNAL: Record<SourceKind, SourceSignal> = {
  building_law: 'law',
  office: 'office',
  project: 'project',
  web: 'auto',
  measurement: 'model',
}

export const AGENT_AUTHORED_LANE = 'office_agent'
export const AGENT_AUTHORED_LANE_LABEL = PRODUCT_NAME + '-Dokument'

export const MAIL_LANE = 'project_mail'
export const OFFICE_MAIL_LANE = 'office_mail'
export const MAIL_LANE_LABEL = 'E-Mail'

const LANE_KIND_PREFIXES: ReadonlyArray<readonly [string, SourceKind]> = [
  ['building_law', 'building_law'],
  ['authority', 'building_law'],
  ['external_standard', 'building_law'],
  ['office', 'office'],
  ['project', 'project'],
  ['web', 'web'],
  ['measurement', 'measurement'],
]

export const kindForLane = (lane: string | null | undefined): SourceKind => {
  const key = ((modernizeLane(lane) ?? '') as string).trim().toLowerCase()
  for (const [prefix, kind] of LANE_KIND_PREFIXES) {
    if (key === prefix || key.startsWith(`${prefix}_`)) return kind
  }
  return 'web'
}

export type Shelf = (typeof SHELVES)[number]

export { SHELVES }

const SHELF_SET: ReadonlySet<string> = new Set<string>(SHELVES)

export const asShelf = (value: string | null | undefined): Shelf | undefined => {
  const key = (value ?? '').trim().toLowerCase()
  return SHELF_SET.has(key) ? (key as Shelf) : undefined
}

export const CITATION_KEY_QUALIFIERS: ReadonlyArray<readonly [qualifier: string, shelf: Shelf]> = [
  ['Büroablage', 'office_shelf'],
  ['Projektwissen', 'project'],
  ['Basiswissen', 'base'],
  ['Private Sitzung', 'session'],
  ['Büroarchiv', 'office_shelf'],
]

export const scopeForQualifier = (qualifier: string | null | undefined): Shelf | undefined => {
  const key = (qualifier ?? '').trim().toLowerCase()
  if (!key) return undefined
  return CITATION_KEY_QUALIFIERS.find(([label]) => label.toLowerCase() === key)?.[1]
}

export const authorityTag = (lane: string | null | undefined): string | null => {
  const key = ((modernizeLane(lane) ?? '') as string).toLowerCase()
  if (key.startsWith('building_law_oib')) return 'OIB'
  if (key === 'external_standard') return 'ÖNORM'
  if (key === 'authority') return 'Behörde'
  if (key === 'building_law_base') return null
  if (key.startsWith('building_law')) return 'RIS' // building_law_ris / _federal / _state / _ordinance
  return null
}

export const accentForLane = (lane: string | null | undefined, signal: SourceTint): SourceTint =>
  ((modernizeLane(lane) ?? '') as string).toLowerCase().startsWith('building_law_oib') ? 'oib' : signal
