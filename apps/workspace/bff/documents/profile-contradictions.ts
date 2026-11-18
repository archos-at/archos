import { flattenIntakeQuestions } from '@/lib/project-profile/intake-conditions'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectIntakeQuestion } from '@/lib/project-profile/intake-types'
import { formatIntakeAnswer } from '@/lib/project-profile/intake-vocabulary'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'
import type { Dossier, DossierFactKey } from './dossier'

export const PROFILE_COMPARED_KEYS = [
  'building_class',
  'storeys_above_ground',
  'storeys_below_ground',
  'plot_area',
  'construction_method',
  'use',
  'federal_state',
] as const
export type ProfileComparedKey = (typeof PROFILE_COMPARED_KEYS)[number]

type Reading = 'class' | 'count' | 'area' | 'construction' | 'use' | 'state'

const COMPARISONS: Readonly<Record<ProfileComparedKey, { profileKey: string; reading: Reading }>> = {
  building_class: { profileKey: 'building_class', reading: 'class' },
  storeys_above_ground: { profileKey: 'storeys_above_ground', reading: 'count' },
  storeys_below_ground: { profileKey: 'storeys_below_ground', reading: 'count' },
  plot_area: { profileKey: 'plot_area', reading: 'area' },
  construction_method: { profileKey: 'construction_method', reading: 'construction' },
  use: { profileKey: 'uses', reading: 'use' },
  federal_state: { profileKey: 'federal_state', reading: 'state' },
}

export interface ProfileFacts {
  facts?: Readonly<Record<string, { value?: unknown } | undefined>> | null
}

export interface ProfileDisagreement {
  value: string
  unit: string | null
  pages: number[]
}

export interface ProfileSide {
  key: ProfileComparedKey
  profileKey: string
  display: string
}

const valuesOf = (value: unknown): unknown[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? (value as unknown[]) : [value]

function confirmedValues(profile: ProfileFacts | null, key: string): unknown[] {
  const facts = profile?.facts ?? {}
  return Object.keys(facts)
    .filter((name) => {
      const [base, , zone] = name.split('@')
      return base === key && zone === undefined
    })
    .sort()
    .flatMap((name) => valuesOf(facts[name]?.value))
}

function fold(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
}

const CLASS_ALONE = /^(?:gk|geb(?:ae)?udeklasse)?\s*([1-5])$/
const CLASS_NAMED = /\b(?:gk|gebaeudeklasse)\s*([1-5])\b/

export function buildingClassNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null
  if (typeof value !== 'string') return null
  const text = fold(value)
  const match = CLASS_ALONE.exec(text) ?? CLASS_NAMED.exec(text)
  return match ? Number(match[1]) : null
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/,0+$/, '').replace(/\.0+$/, '')
  return /^\d{1,3}$/.test(text) ? Number(text) : null
}

export function germanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/[\s  ]/g, '')
  if (!/^\d[\d.,]*$/.test(text)) return null
  let normalized: string
  if (text.includes(',')) normalized = text.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, '')
  else normalized = text
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

const SQUARE_METRES = new Set(['m²', 'm2', 'qm', 'm^2'])

const CONSTRUCTION_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/stahlbeton|\bbetonbau|\bortbeton/, 'reinforced_concrete'],
  [/holz/, 'timber'],
  [/\bstahlbau|\bstahlskelett|\bstahltragwerk/, 'steel'],
  [/mauerwerk|ziegel|\bmassivbau/, 'masonry_solid'],
]

const USE_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bwohn/, 'residential'],
  [/\bbuero|\bverwaltung/, 'office'],
  [/\bhandel|\bverkauf|\bgeschaeftslokal/, 'retail'],
  [/\bgastro|\brestaurant|\bcafe\b/, 'catering'],
  [/\bhotel|\bbeherbergung|\bpension\b/, 'lodging'],
  [/\bversammlung|\bveranstaltung/, 'assembly'],
  [/\bschule|\bkindergarten|\bbildung|\bbetreuung/, 'education'],
  [/\bkrankenhaus|\bpflege|\bklinik|\bgesundheit/, 'healthcare'],
  [/\bproduktion|\bgewerbe|\blager\b|\blagerhalle|\bwerkstatt/, 'production'],
  [/\blandwirtschaft/, 'agriculture'],
]

const STATE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  noe: 'lower_austria',
  ooe: 'upper_austria',
  stmk: 'styria',
  ktn: 'carinthia',
  sbg: 'salzburg',
  vbg: 'vorarlberg',
  bgld: 'burgenland',
}

const STATES: ReadonlySet<string> = new Set(SITE_SUBDIVISIONS.options.map((option) => option.token))

function tokensOf(text: string, words: ReadonlyArray<[RegExp, string]>): string[] {
  const folded = fold(text)
  return [...new Set(words.filter(([pattern]) => pattern.test(folded)).map(([, token]) => token))]
}

export function federalStateToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const folded = fold(value).replace(/^bundesland /, '').replace(/\.$/, '')
  const token = STATE_ABBREVIATIONS[folded] ?? normalizeProfileToken('federal_state', folded.replace(/ /g, '_'))
  return STATES.has(token) ? token : null
}

function profileTokens(values: readonly unknown[], profileKey: string): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => normalizeProfileToken(profileKey, fold(value)))
    .filter((token) => token !== 'open')
}

interface Reader {
  document(value: string, unit: string | null): string[] | null
  profile(values: readonly unknown[], profileKey: string): string[]
  disagrees(document: readonly string[], profile: readonly string[]): boolean
}

const noOverlap = (a: readonly string[], b: readonly string[]): boolean => !a.some((value) => b.includes(value))

const numbers = (values: readonly unknown[], read: (value: unknown) => number | null): string[] =>
  [...new Set(values.map(read).filter((value): value is number => value !== null))].map(String)

const READERS: Readonly<Record<Reading, Reader>> = {
  class: {
    document: (value) => {
      const number = buildingClassNumber(value)
      return number === null ? null : [String(number)]
    },
    profile: (values) => numbers(values, buildingClassNumber),
    disagrees: noOverlap,
  },
  count: {
    document: (value) => {
      const number = wholeNumber(value)
      return number === null ? null : [String(number)]
    },
    profile: (values) => numbers(values, wholeNumber),
    disagrees: noOverlap,
  },
  area: {
    document: (value, unit) => {
      if (unit !== null && !SQUARE_METRES.has(unit.trim().toLowerCase())) return null
      const number = germanNumber(value)
      return number === null || number <= 0 ? null : [String(number)]
    },
    profile: (values) => numbers(values, germanNumber),
    disagrees: (document, profile) =>
      !document.some((a) => profile.some((b) => Math.abs(Number(a) - Number(b)) <= 0.01 * Math.max(Number(a), Number(b)))),
  },
  construction: {
    document: (value) => {
      const tokens = tokensOf(value, CONSTRUCTION_WORDS)
      return tokens.length > 0 ? tokens : null
    },
    profile: profileTokens,
    disagrees: noOverlap,
  },
  use: {
    document: (value) => {
      const tokens = tokensOf(value, USE_WORDS)
      return tokens.length > 0 ? tokens : null
    },
    profile: profileTokens,
    disagrees: noOverlap,
  },
  state: {
    document: (value) => {
      const token = federalStateToken(value)
      return token ? [token] : null
    },
    profile: (values) => [...new Set(values.map(federalStateToken).filter((token): token is string => token !== null))],
    disagrees: noOverlap,
  },
}

let questionsByKey: Map<string, ProjectIntakeQuestion> | null = null

function questionFor(profileKey: string): ProjectIntakeQuestion | null {
  if (!questionsByKey) {
    questionsByKey = new Map()
    for (const question of flattenIntakeQuestions(projectIntakeDefinitionV1)) {
      const match = /^\/facts\/([a-z_]+)\/value$/.exec(question.writesTo ?? '')
      if (match && !questionsByKey.has(match[1])) questionsByKey.set(match[1], question)
    }
  }
  return questionsByKey.get(profileKey) ?? null
}

function profileSide(profile: ProfileFacts | null, key: ProfileComparedKey): { side: ProfileSide; tokens: string[] } | null {
  const { profileKey, reading } = COMPARISONS[key]
  const raw = confirmedValues(profile, profileKey)
  const tokens = READERS[reading].profile(raw, profileKey)
  if (tokens.length === 0) return null
  const question = questionFor(profileKey)
  let display: string
  if (reading === 'class') display = tokens.join(', ')
  else if (reading === 'state' || reading === 'construction' || reading === 'use')
    display = tokens
      .map((token) =>
        question ? formatIntakeAnswer(question, question.type === 'multi_select' ? [token] : token) : token
      )
      .join(', ')
  else
    display = tokens
      .map((token) => (question ? formatIntakeAnswer(question, Number(token)) : token))
      .join(', ')
  return { side: { key, profileKey, display }, tokens }
}

function statementsOf(dossier: Dossier | null): Map<ProfileComparedKey, ProfileDisagreement[]> {
  const statements = new Map<ProfileComparedKey, ProfileDisagreement[]>()
  const add = (key: ProfileComparedKey, statement: ProfileDisagreement) =>
    statements.set(key, [...(statements.get(key) ?? []), statement])
  for (const fact of dossier?.facts ?? []) {
    if (!(PROFILE_COMPARED_KEYS as readonly string[]).includes(fact.key)) continue
    add(fact.key as ProfileComparedKey & DossierFactKey, {
      value: fact.value,
      unit: fact.unit,
      pages: fact.page === null ? [] : [fact.page],
    })
  }
  if (dossier?.place?.state) add('federal_state', { value: dossier.place.state, unit: null, pages: [] })
  return statements
}

export interface DocumentProfileDisagreement {
  profile: ProfileSide
  statements: ProfileDisagreement[]
}

export function profileDisagreements(dossier: Dossier | null, profile: ProfileFacts | null): DocumentProfileDisagreement[] {
  if (!dossier || !profile?.facts) return []
  const found: DocumentProfileDisagreement[] = []
  for (const [key, statements] of statementsOf(dossier)) {
    const side = profileSide(profile, key)
    if (!side) continue
    const reader = READERS[COMPARISONS[key].reading]
    const read = statements
      .map((statement) => ({ statement, tokens: reader.document(statement.value, statement.unit) }))
      .filter((entry): entry is { statement: ProfileDisagreement; tokens: string[] } => entry.tokens !== null)
    if (read.length === 0) continue
    if (read.some(({ tokens }) => !reader.disagrees(tokens, side.tokens))) continue
    found.push({ profile: side.side, statements: mergeStatements(read.map(({ statement }) => statement)) })
  }
  return found.sort((a, b) => PROFILE_COMPARED_KEYS.indexOf(a.profile.key) - PROFILE_COMPARED_KEYS.indexOf(b.profile.key))
}

function mergeStatements(statements: readonly ProfileDisagreement[]): ProfileDisagreement[] {
  const byValue = new Map<string, ProfileDisagreement>()
  for (const statement of statements) {
    const identity = fold(statement.value)
    const known = byValue.get(identity)
    if (!known) {
      byValue.set(identity, { ...statement, pages: [...statement.pages] })
      continue
    }
    known.pages = [...new Set([...known.pages, ...statement.pages])].sort((a, b) => a - b)
  }
  return [...byValue.values()]
}
