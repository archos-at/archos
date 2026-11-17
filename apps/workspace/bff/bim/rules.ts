import {
  dimensionProperty,
  externalFlag,
  numericProperty,
  property,
  quantity,
  undecidableWithoutExternalFlag,
} from './rule-values'
import type { RuleBasis } from './rule-basis'
import type { BimElement } from './types'

export type BimCheckStatus = 'pass' | 'fail' | 'undecidable'

export interface BimRuleFacts {
  bases: Readonly<Record<string, RuleBasis>>
  buildingClass?: number | null
  mainUse?: string | null
  storeys?: Array<{ name: string; elevation: number | null }>
  lengthScale?: number | null
}

export interface BimElementVerdict {
  globalId: string
  name: string | null
  storeyName: string | null
  status: BimCheckStatus
  reading: string
}

export interface BimMissingProperty {
  path: string
  elements: number
}

export interface BimRuleResult {
  ruleId: string
  richtlinie: string
  clause: string
  titleDe: string
  thresholdDe: string
  applicable: boolean
  notApplicableReason?: string
  hint?: string
  passed: number
  failed: number
  undecidable: number
  failures: BimElementVerdict[]
  unknowns: BimElementVerdict[]
  truncated: boolean
  missing: BimMissingProperty[]
}

const VISIBLE_VERDICTS = 25

function toMetres(value: number | null, scale?: number | null): number | null {
  if (value === null) return null
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) return value * scale
  return value > 20 ? value / 1000 : value
}

function toCentimetres(value: number | null, scale?: number | null): number | null {
  const metres = toMetres(value, scale)
  return metres === null ? null : metres * 100
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function decimalsOf(value: number): number {
  const text = String(value)
  if (text.includes('e')) return 0
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function decimal(value: number, minDigits: number): string {
  return value.toFixed(Math.max(minDigits, decimalsOf(value))).replace('.', ',')
}

function measure(
  value: number,
  satisfies: (candidate: number) => boolean,
  digits = 2,
  maxDigits = 5
): string {
  const truth = satisfies(value)
  for (let d = digits; d < maxDigits; d += 1) {
    if (satisfies(round(value, d)) === truth) return decimal(round(value, d), digits)
  }
  return decimal(round(value, maxDigits), digits)
}

function fireResistanceMinutes(raw: string): number | null {
  const match = /(\d{2,3})/.exec(raw)
  if (!match) return null
  const minutes = Number(match[1])
  return Number.isFinite(minutes) ? minutes : null
}

const EURO_CRITERIA = new Set(['R', 'E', 'I', 'M', 'W', 'S', 'C'])

function compareFireRating(declared: string, required: string): 'meets' | 'short' | 'unreadable' {
  if (/[/|]|\bund\b|\band\b/i.test(declared)) return 'unreadable'

  const declaredMinutes = fireResistanceMinutes(declared)
  const requiredMinutes = fireResistanceMinutes(required)
  if (declaredMinutes === null || requiredMinutes === null) return 'unreadable'

  const requiredLetters = /^[A-Za-z]+/.exec(required.trim())?.[0]?.toUpperCase() ?? ''
  const declaredLetters = /^[A-Za-z]+/.exec(declared.trim())?.[0]?.toUpperCase() ?? ''
  if (declaredLetters === '' || [...declaredLetters].some((letter) => !EURO_CRITERIA.has(letter))) {
    return 'unreadable'
  }
  const coversCriteria = [...requiredLetters].every((letter) => declaredLetters.includes(letter))
  return declaredMinutes >= requiredMinutes && coversCriteria ? 'meets' : 'short'
}

const FIRE_RESISTANCE_R_MINUTES: Record<'top' | 'above' | 'below', Record<number, number | null>> = {
  top: { 1: null, 2: 30, 3: 30, 4: 30, 5: 60 },
  above: { 1: 30, 2: 30, 3: 60, 4: 60, 5: 90 },
  below: { 1: 60, 2: 60, 3: 90, 4: 90, 5: 90 },
}

export type BimStoreyPosition = 'top' | 'above' | 'below'

const STOREY_LABEL: Record<BimStoreyPosition, string> = {
  top: 'oberstes Geschoß',
  above: 'oberirdisches Geschoß',
  below: 'Kellergeschoß',
}

export function classifyStorey(
  storeyName: string | null,
  storeys: BimRuleFacts['storeys']
): BimStoreyPosition | null {
  if (!storeyName || !storeys || storeys.length === 0) return null
  const known = storeys.filter((entry) => typeof entry.elevation === 'number')
  const match = known.find((entry) => entry.name === storeyName)
  if (!match || typeof match.elevation !== 'number') return null
  if (match.elevation < 0) return 'below'
  const highest = Math.max(...known.map((entry) => entry.elevation as number))
  if (match.elevation !== highest) return 'above'
  const atHighest = known.filter((entry) => entry.elevation === highest).length
  return atHighest === 1 ? 'top' : null
}


interface RuleDefinition {
  id: string
  designation: string
  edition: string
  clause: string
  titleDe: string
  thresholdDe: string
  ifcTypes: string[]
  scope?: (element: BimElement) => boolean
  notApplicable?: (facts: BimRuleFacts) => string | null
  judge: (
    element: BimElement,
    facts: BimRuleFacts
  ) => { status: BimCheckStatus; reading: string; missing?: string }
}

const mayBeLoadBearing = (element: BimElement): boolean =>
  property(element, ['LoadBearing']) !== false

const OCCUPIED_MARKERS = [
  'wohn',
  'schlaf',
  'kind',
  'büro',
  'buero',
  'ess',
  'küche',
  'kueche',
  'arbeits',
  'besprechung',
  'aufenthalt',
  'unterricht',
  'klasse',
  'seminar',
  'verkauf',
  'praxis',
  'ordination',
  'office',
  'kitchen',
  'meeting',
  'living',
  'bed',
]

const NON_OCCUPIED_WORDS = new Set([
  'gang',
  'bad',
  'wc',
  'stair',
  'stairs',
  'store',
  'plant',
  'lobby',
  'toilet',
  'shaft',
  'hall',
])

const NON_OCCUPIED_STEMS = [
  'flur',
  'stiege',
  'treppe',
  'technik',
  'schacht',
  'abstell',
  'lager',
  'garage',
  'vorraum',
  'keller',
  'bade',
  'sanitär',
  'sanitaer',
  'corridor',
  'hallway',
  'technical',
  'storage',
  'bathroom',
  'restroom',
  'utility',
  'circulation',
]

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^0-9a-zäöüß]+/u)
    .filter((word) => word !== '')
}

const UNINFORMATIVE_SPACE_TYPES = new Set(['', 'SPACE', 'INTERNAL', 'USERDEFINED', 'NOTDEFINED'])

const isOccupiedSpace = (element: BimElement): boolean => {
  const predefined = (element.predefinedType ?? '').toUpperCase()
  if (!UNINFORMATIVE_SPACE_TYPES.has(predefined)) return false
  const words = nameWords(element.name ?? '')
  const edgeMatch = (word: string, stem: string): boolean =>
    word.startsWith(stem) || word.endsWith(stem)
  if (words.some((word) => OCCUPIED_MARKERS.some((marker) => edgeMatch(word, marker)))) return true
  return !words.some(
    (word) =>
      NON_OCCUPIED_WORDS.has(word) || NON_OCCUPIED_STEMS.some((stem) => edgeMatch(word, stem))
  )
}

const ACOUSTIC_LABEL = /\b(?:R['´’]?\s*w|DnT\s*,?\s*w|D\s*n\s*T|Rw|SRI|Schalld[äa]mm[- ]?Ma[sß]{1,2})\b/i
const NUMBER = /-?\d+(?:[.,]\d+)?/

function ratedSoundReduction(raw: string | number | boolean | null): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null

  const parse = (token: string): number | null => {
    const value = Number(token.replace(',', '.'))
    return Number.isFinite(value) ? value : null
  }

  const bare = new RegExp(`^${NUMBER.source}$`).exec(text)
  if (bare) return parse(bare[0])

  const labelled = ACOUSTIC_LABEL.exec(text)
  if (labelled) {
    const after = new RegExp(NUMBER.source).exec(text.slice(labelled.index + labelled[0].length))
    if (after) return parse(after[0])
  }

  const withUnit = new RegExp(`(${NUMBER.source})\\s*dB\\b`, 'i').exec(text)
  if (withUnit) return parse(withUnit[1])

  return null
}

export const LEGACY_BIM_RULE_IDS: Readonly<Record<string, string>> = {
  'oib4-treppe-steigungsverhaeltnis': 'oib4-stair-rise-run-ratio',
  'oib4-tuer-durchgangsbreite': 'oib4-door-clear-width',
  'oib3-raumhoehe': 'oib3-room-height',
  'oib2-feuerwiderstand-tragend': 'oib2-fire-resistance-load-bearing',
  'oib6-u-wert-aussenwand': 'oib6-u-value-external-wall',
  'oib6-u-wert-fenster': 'oib6-u-value-window',
  'oib5-schalldaemmung-deklariert': 'oib5-sound-insulation-declared',
}

export const canonicalBimRuleId = (ruleId: string): string => LEGACY_BIM_RULE_IDS[ruleId] ?? ruleId

export const BIM_RULES: RuleDefinition[] = [
  {
    id: 'oib4-stair-rise-run-ratio',
    designation: 'OIB-Richtlinie 4',
    edition: 'Ausgabe Mai 2023',
    clause: '2.2',
    titleDe: 'Treppen — Steigungsverhältnis',
    thresholdDe: '2 × Steigung + Auftritt = 59–65 cm, Steigung ≤ 18 cm, Auftritt ≥ 28 cm',
    ifcTypes: ['IfcStairFlight'],
    judge: (element, facts) => {
      const riser = toCentimetres(
        dimensionProperty(element, ['RiserHeight']) ?? quantity(element, ['RiserHeight']),
        facts.lengthScale
      )
      const tread = toCentimetres(
        dimensionProperty(element, ['TreadLength']) ?? quantity(element, ['TreadLength']),
        facts.lengthScale
      )
      if (riser === null || tread === null) {
        return {
          status: 'undecidable',
          reading:
            'Steigung oder Auftritt nicht im Modell veröffentlicht — Steigungsverhältnis nicht berechenbar',
          missing: 'IfcStairFlight.RiserHeight / TreadLength',
        }
      }
      const ratio = round(2 * riser + tread, 1)
      const ok = ratio >= 59 && ratio <= 65 && riser <= 18 && tread >= 28
      return {
        status: ok ? 'pass' : 'fail',
        reading:
          `2h + b = ${decimal(ratio, 1)} cm (h = ${measure(riser, (h) => h <= 18, 1)} cm, ` +
          `b = ${measure(tread, (b) => b >= 28, 1)} cm) — ` +
          'Schwellwert 59–65 cm, h ≤ 18 cm, b ≥ 28 cm',
      }
    },
  },
  {
    id: 'oib4-door-clear-width',
    designation: 'OIB-Richtlinie 4',
    edition: 'Ausgabe Mai 2023',
    clause: '3',
    titleDe: 'Türen — lichte Durchgangsbreite',
    thresholdDe: 'lichte Durchgangsbreite ≥ 0,80 m',
    ifcTypes: ['IfcDoor'],
    judge: (element, facts) => {
      const clear = toMetres(
        quantity(element, ['ClearWidth']) ?? dimensionProperty(element, ['ClearWidth']),
        facts.lengthScale
      )
      if (clear !== null) {
        return {
          status: clear >= 0.8 ? 'pass' : 'fail',
          reading: `Lichte Durchgangsbreite ${measure(clear, (w) => w >= 0.8)} m — Schwellwert ≥ 0,80 m`,
        }
      }

      const nominal = toMetres(
        quantity(element, ['Width']) ?? dimensionProperty(element, ['OverallWidth', 'Width']),
        facts.lengthScale
      )
      if (nominal === null) {
        return {
          status: 'undecidable',
          reading: 'Keine Breite im Modell veröffentlicht',
          missing: 'Qto_DoorBaseQuantities.ClearWidth',
        }
      }
      if (nominal < 0.8) {
        return {
          status: 'fail',
          reading:
            `Nennbreite ${measure(nominal, (w) => w >= 0.8)} m — die lichte Durchgangsbreite ist kleiner und ` +
            'liegt damit unter dem Schwellwert von 0,80 m',
        }
      }
      return {
        status: 'undecidable',
        reading:
          `Nur die Nennbreite ${decimal(round(nominal), 2)} m veröffentlicht — die lichte ` +
          'Durchgangsbreite ist um Rahmen und Anschlag kleiner und nicht daraus ableitbar',
        missing: 'Qto_DoorBaseQuantities.ClearWidth',
      }
    },
  },
  {
    id: 'oib3-room-height',
    designation: 'OIB-Richtlinie 3',
    edition: 'Ausgabe Mai 2023',
    clause: '2',
    titleDe: 'Aufenthaltsräume — lichte Raumhöhe',
    thresholdDe: 'lichte Raumhöhe ≥ 2,50 m',
    ifcTypes: ['IfcSpace'],
    scope: isOccupiedSpace,
    judge: (element, facts) => {
      const clear = toMetres(
        quantity(element, ['FinishCeilingHeight', 'ClearHeight']) ??
          dimensionProperty(element, ['FinishCeilingHeight', 'ClearHeight']),
        facts.lengthScale
      )
      if (clear !== null) {
        return {
          status: clear >= 2.5 ? 'pass' : 'fail',
          reading: `Lichte Raumhöhe ${measure(clear, (h) => h >= 2.5)} m — Schwellwert ≥ 2,50 m`,
        }
      }

      const gross = toMetres(
        quantity(element, ['Height']) ?? dimensionProperty(element, ['Height']),
        facts.lengthScale
      )
      if (gross === null) {
        return {
          status: 'undecidable',
          reading: 'Keine Raumhöhe im Modell veröffentlicht',
          missing: 'Qto_SpaceBaseQuantities.FinishCeilingHeight',
        }
      }
      if (gross < 2.5) {
        return {
          status: 'fail',
          reading:
            `Brutto-Raumhöhe ${measure(gross, (h) => h >= 2.5)} m — die lichte Raumhöhe ist ` +
            'kleiner und liegt damit unter dem Schwellwert von 2,50 m',
        }
      }
      return {
        status: 'undecidable',
        reading:
          `Nur die Brutto-Raumhöhe ${decimal(round(gross), 2)} m veröffentlicht — die lichte ` +
          'Raumhöhe ist um Fußbodenaufbau und abgehängte Decke kleiner und nicht daraus ableitbar',
        missing: 'Qto_SpaceBaseQuantities.FinishCeilingHeight',
      }
    },
  },
  {
    id: 'oib2-fire-resistance-load-bearing',
    designation: 'OIB-Richtlinie 2',
    edition: 'Ausgabe Mai 2023',
    clause: '3',
    titleDe: 'Tragende Bauteile — Feuerwiderstand',
    thresholdDe:
      'R nach Gebäudeklasse und Geschoßlage (OIB 2, Tabelle 1b, Zeile 1): oberirdisch GK1/2 R 30 … GK5 R 90, unterirdisch GK1/2 R 60 … GK3+ R 90',
    ifcTypes: ['IfcWall', 'IfcColumn', 'IfcBeam', 'IfcMember'],
    scope: mayBeLoadBearing,
    judge: (element, facts) => {
      if (property(element, ['LoadBearing']) !== true) {
        return {
          status: 'undecidable',
          reading: 'Nicht angegeben, ob das Bauteil tragend ist — Anforderung nicht bestimmbar',
          missing: 'Pset_WallCommon.LoadBearing (bzw. Pset_*Common.LoadBearing)',
        }
      }
      const position = classifyStorey(element.storeyName, facts.storeys)
      if (position === null) {
        return {
          status: 'undecidable',
          reading:
            'Geschoßlage des Bauteils nicht bestimmbar — die geforderte Feuerwiderstandsdauer ' +
            'hängt davon ab (oberirdisch, oberstes Geschoß oder Kellergeschoß)',
          missing: 'IfcBuildingStorey.Elevation (Höhenlage der Geschoße)',
        }
      }
      const minutes = FIRE_RESISTANCE_R_MINUTES[position][facts.buildingClass ?? 0]
      if (minutes === null) {
        return {
          status: 'pass',
          reading: `Im obersten Geschoß der Gebäudeklasse ${facts.buildingClass} wird kein Feuerwiderstand gefordert`,
        }
      }
      const required = minutes ? `R ${minutes}` : undefined
      if (!required) {
        return {
          status: 'undecidable',
          reading: 'Gebäudeklasse unbekannt — erforderlicher Feuerwiderstand nicht bestimmbar',
          missing: 'Projektangabe: Gebäudeklasse',
        }
      }
      const declared = property(element, ['FireRating'])
      if (typeof declared !== 'string' || declared.trim() === '') {
        return {
          status: 'undecidable',
          reading: `Kein Feuerwiderstand am Bauteil hinterlegt — erforderlich ${required}`,
          missing: 'Pset_WallCommon.FireRating (bzw. Pset_*Common.FireRating)',
        }
      }
      const verdict = compareFireRating(declared, required)
      if (verdict === 'unreadable') {
        return {
          status: 'undecidable',
          reading:
            `Feuerwiderstand „${declared}“ nicht mit ${required} vergleichbar ` +
            '(andere oder unlesbare Klassifizierung) — bitte manuell prüfen',
          missing: 'Pset_WallCommon.FireRating in der Form „REI 90“',
        }
      }
      return {
        status: verdict === 'meets' ? 'pass' : 'fail',
        reading:
          `Feuerwiderstand ${declared} — erforderlich ${required} ` +
          `(Gebäudeklasse ${facts.buildingClass}, ${STOREY_LABEL[position]})`,
      }
    },
  },
  {
    id: 'oib6-u-value-external-wall',
    designation: 'OIB-Richtlinie 6',
    edition: 'Ausgabe Mai 2023',
    clause: '4.1',
    titleDe: 'Außenwände — Wärmedurchgangskoeffizient',
    thresholdDe: 'U ≤ 0,35 W/m²K',
    ifcTypes: ['IfcWall', 'IfcWallStandardCase'],
    scope: (element) => externalFlag(element) !== false,
    notApplicable: (facts) =>
      facts.mainUse === 'storage' || facts.mainUse === 'agriculture'
        ? 'OIB 6 gilt für unkonditionierte Lager-/landwirtschaftliche Gebäude nicht ohne Weiteres'
        : null,
    judge: (element) => {
      if (externalFlag(element) === null) {
        return undecidableWithoutExternalFlag('Pset_WallCommon.IsExternal')
      }
      const uValue = numericProperty(element, ['ThermalTransmittance'])
      if (uValue === null) {
        return {
          status: 'undecidable',
          reading: 'Kein U-Wert am Bauteil hinterlegt',
          missing: 'Pset_WallCommon.ThermalTransmittance',
        }
      }
      if (uValue <= 0) {
        return {
          status: 'undecidable',
          reading: `U = ${decimal(round(uValue), 2)} W/m²K ist kein physikalisch möglicher Wert — vermutlich nicht gesetzt`,
          missing: 'Pset_WallCommon.ThermalTransmittance (echter Wert, nicht 0)',
        }
      }
      return {
        status: uValue <= 0.35 ? 'pass' : 'fail',
        reading: `U = ${measure(uValue, (u) => u <= 0.35)} W/m²K — Schwellwert ≤ 0,35 W/m²K`,
      }
    },
  },
  {
    id: 'oib6-u-value-window',
    designation: 'OIB-Richtlinie 6',
    edition: 'Ausgabe Mai 2023',
    clause: '4.1',
    titleDe: 'Fenster — Wärmedurchgangskoeffizient',
    thresholdDe: 'U ≤ 1,40 W/m²K',
    ifcTypes: ['IfcWindow'],
    notApplicable: (facts) =>
      facts.mainUse === 'storage' || facts.mainUse === 'agriculture'
        ? 'OIB 6 gilt für unkonditionierte Lager-/landwirtschaftliche Gebäude nicht ohne Weiteres'
        : null,
    judge: (element) => {
      const uValue = numericProperty(element, ['ThermalTransmittance'])
      if (uValue === null) {
        return {
          status: 'undecidable',
          reading: 'Kein U-Wert am Fenster hinterlegt',
          missing: 'Pset_WindowCommon.ThermalTransmittance',
        }
      }
      if (uValue <= 0) {
        return {
          status: 'undecidable',
          reading: `U = ${decimal(round(uValue), 2)} W/m²K ist kein physikalisch möglicher Wert — vermutlich nicht gesetzt`,
          missing: 'Pset_WindowCommon.ThermalTransmittance (echter Wert, nicht 0)',
        }
      }
      return {
        status: uValue <= 1.4 ? 'pass' : 'fail',
        reading: `U = ${measure(uValue, (u) => u <= 1.4)} W/m²K — Schwellwert ≤ 1,40 W/m²K`,
      }
    },
  },
  {
    id: 'oib5-sound-insulation-declared',
    designation: 'OIB-Richtlinie 5',
    edition: 'Ausgabe Mai 2023',
    clause: '3',
    titleDe: 'Trennbauteile — Schalldämmung deklariert',
    thresholdDe: 'bewertetes Schalldämm-Maß am Bauteil hinterlegt',
    ifcTypes: ['IfcWall', 'IfcWallStandardCase', 'IfcSlab'],
    scope: (element) => externalFlag(element) !== true,
    notApplicable: (facts) =>
      facts.mainUse && !['residential', 'lodging', 'healthcare', 'office', 'assembly'].includes(facts.mainUse)
        ? 'OIB 5 ist für diese Nutzung nicht lärmempfindlich einschlägig'
        : null,
    judge: (element) => {
      if (externalFlag(element) === null) {
        return undecidableWithoutExternalFlag(
          'Pset_WallCommon.IsExternal (bzw. Pset_SlabCommon.IsExternal)'
        )
      }
      const rating = property(element, ['AcousticRating'])
      if (rating === null || String(rating).trim() === '') {
        return {
          status: 'undecidable',
          reading: 'Kein bewertetes Schalldämm-Maß am Bauteil hinterlegt',
          missing: 'Pset_WallCommon.AcousticRating',
        }
      }
      const decibels = ratedSoundReduction(rating)
      if (decibels === null) {
        return {
          status: 'undecidable',
          reading: `„${String(rating)}“ ist kein bewertetes Schalldämm-Maß`,
          missing: 'Pset_WallCommon.AcousticRating (bewertetes Maß in dB, z. B. „Rw 53 dB“)',
        }
      }
      if (decibels <= 0) {
        return {
          status: 'undecidable',
          reading: `Schalldämm-Maß ${String(rating)} ist kein bewertetes Maß — vermutlich nicht gesetzt`,
          missing: 'Pset_WallCommon.AcousticRating (echter Wert, nicht 0)',
        }
      }
      return {
        status: 'pass',
        reading: `Schalldämm-Maß ${decimal(decibels, 0)} dB hinterlegt (${String(rating)})`,
      }
    },
  },
]

const CASE_SUFFIX = /(standardcase|elementedcase)$/

const normaliseType = (ifcType: string): string => ifcType.toLowerCase().replace(CASE_SUFFIX, '')

export function ifcTypeVariants(ifcType: string): string[] {
  const base = normaliseType(ifcType)
  return [base, `${base}standardcase`, `${base}elementedcase`]
}

const matchesType = (element: BimElement, types: readonly string[]): boolean =>
  types.some((type) => normaliseType(type) === normaliseType(element.ifcType))

export function runBimRules(
  elements: readonly BimElement[],
  facts: BimRuleFacts
): BimRuleResult[] {
  return BIM_RULES.map((rule) => {
    const basis = facts.bases[rule.id] ?? { kind: 'hint', reason: 'Hinweis: Grundlage am Standort nicht bestimmt' }
    const notApplicableReason = rule.notApplicable?.(facts) ?? null
    const judge: RuleDefinition['judge'] =
      basis.kind === 'hint' ? (element) => ({ status: 'undecidable', reading: `${rule.judge(element, facts).reading} — ${basis.reason}` }) : rule.judge
    const base = {
      ruleId: rule.id,
      richtlinie: `${rule.designation}, ${rule.edition}`,
      ...(basis.kind === 'hint' ? { hint: basis.reason } : {}),
      clause: rule.clause,
      titleDe: rule.titleDe,
      thresholdDe: rule.thresholdDe,
      passed: 0,
      failed: 0,
      undecidable: 0,
      failures: [] as BimElementVerdict[],
      unknowns: [] as BimElementVerdict[],
      truncated: false,
      missing: [] as BimMissingProperty[],
    }
    if (notApplicableReason) {
      return { ...base, applicable: false, notApplicableReason }
    }

    const scoped = elements.filter(
      (element) => matchesType(element, rule.ifcTypes) && (rule.scope?.(element) ?? true)
    )

    const failures: BimElementVerdict[] = []
    const unknowns: BimElementVerdict[] = []
    const missing = new Map<string, number>()
    let passed = 0
    let failed = 0
    let undecidable = 0
    let truncated = false

    for (const element of scoped) {
      const { status, reading, missing: missingPath } = judge(element, facts)
      const verdict: BimElementVerdict = {
        globalId: element.globalId,
        name: element.name,
        storeyName: element.storeyName,
        status,
        reading,
      }
      if (status === 'pass') {
        passed += 1
        continue
      }
      if (status === 'fail') {
        failed += 1
        if (failures.length < VISIBLE_VERDICTS) failures.push(verdict)
        else truncated = true
        continue
      }
      undecidable += 1
      if (unknowns.length < VISIBLE_VERDICTS) unknowns.push(verdict)
      else truncated = true
      if (missingPath) missing.set(missingPath, (missing.get(missingPath) ?? 0) + 1)
    }

    return {
      ...base,
      applicable: true,
      passed,
      failed,
      undecidable,
      failures,
      unknowns,
      truncated,
      missing: [...missing.entries()]
        .map(([path, count]) => ({ path, elements: count }))
        .sort((a, b) => b.elements - a.elements || a.path.localeCompare(b.path)),
    }
  })
}

export interface BimComplianceSummary {
  rulesApplicable: number
  rulesNotApplicable: number
  rulesFailing: number
  rulesUndecidable: number
  rulesPassing: number
  rulesEmpty: number
  elementsFailed: number
  elementsUndecidable: number
}

export function summarizeBimRules(results: readonly BimRuleResult[]): BimComplianceSummary {
  const summary: BimComplianceSummary = {
    rulesApplicable: 0,
    rulesNotApplicable: 0,
    rulesFailing: 0,
    rulesUndecidable: 0,
    rulesPassing: 0,
    rulesEmpty: 0,
    elementsFailed: 0,
    elementsUndecidable: 0,
  }
  for (const result of results) {
    if (!result.applicable) {
      summary.rulesNotApplicable += 1
      continue
    }
    summary.rulesApplicable += 1
    summary.elementsFailed += result.failed
    summary.elementsUndecidable += result.undecidable
    const checked = result.passed + result.failed + result.undecidable
    if (checked === 0) summary.rulesEmpty += 1
    else if (result.failed > 0) summary.rulesFailing += 1
    else if (result.undecidable > 0) summary.rulesUndecidable += 1
    else summary.rulesPassing += 1
  }
  return summary
}

export function missingPropertyShoppingList(
  results: readonly BimRuleResult[]
): Array<{ path: string; elements: number; rules: string[] }> {
  const byPath = new Map<string, { elements: number; rules: Set<string> }>()
  for (const result of results) {
    if (!result.applicable) continue
    for (const entry of result.missing) {
      const bucket = byPath.get(entry.path) ?? { elements: 0, rules: new Set<string>() }
      bucket.elements += entry.elements
      bucket.rules.add(result.ruleId)
      byPath.set(entry.path, bucket)
    }
  }
  return [...byPath.entries()]
    .map(([path, bucket]) => ({ path, elements: bucket.elements, rules: [...bucket.rules].sort() }))
    .sort((a, b) => b.elements - a.elements || a.path.localeCompare(b.path))
}

export interface BimCheckConfirmation {
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
  confirmedAt: string
}

export interface BimRuleResultWithConfirmation extends BimRuleResult {
  confirmation: BimCheckConfirmation | null
  confirmationStale: boolean
}

export function attachConfirmations(
  results: readonly BimRuleResult[],
  confirmations: readonly BimCheckConfirmation[],
  currentModelId: string,
  seriesModelIds: readonly string[] = [currentModelId]
): BimRuleResultWithConfirmation[] {
  const inSeries = new Set(seriesModelIds.length > 0 ? seriesModelIds : [currentModelId])
  inSeries.add(currentModelId)

  const byRule = new Map<string, BimCheckConfirmation>()
  for (const entry of confirmations) {
    if (!inSeries.has(entry.modelId)) continue
    const held = byRule.get(entry.ruleId)
    if (!held) {
      byRule.set(entry.ruleId, entry)
      continue
    }
    if (held.modelId === currentModelId) continue
    if (entry.modelId === currentModelId || entry.confirmedAt > held.confirmedAt) {
      byRule.set(entry.ruleId, entry)
    }
  }

  return results.map((result) => {
    const confirmation = result.hint ? null : (byRule.get(result.ruleId) ?? null)
    return {
      ...result,
      confirmation,
      confirmationStale: confirmation !== null && confirmation.modelId !== currentModelId,
    }
  })
}

export const hasOpenWork = (result: BimRuleResult): boolean =>
  result.applicable && !result.hint && (result.failed > 0 || result.undecidable > 0)

export function rulesWithOpenWork<T extends BimRuleResult>(results: readonly T[]): T[] {
  return results.filter(hasOpenWork)
}

export function outstandingRules(
  results: readonly BimRuleResultWithConfirmation[]
): BimRuleResultWithConfirmation[] {
  return results.filter((result) => hasOpenWork(result) && (result.confirmation === null || result.confirmationStale))
}

export { diffBimCompliance, renderBimComplianceDiff, type BimComplianceChange, type BimComplianceTrend } from './compliance-diff'

export function renderBimRules(results: readonly BimRuleResult[]): string {
  const lines = results.map((result) => {
    const head = `${result.richtlinie} ${result.clause} — ${result.titleDe}`
    if (!result.applicable) return `${head}: nicht einschlägig (${result.notApplicableReason})`
    const checked = result.passed + result.failed + result.undecidable
    if (checked === 0) return `${head}: keine betroffenen Bauteile im Modell`
    if (result.hint) return `${head}: ${result.hint}; ${checked} Bauteile gelesen, keines beurteilt (${result.thresholdDe})`
    return (
      `${head}: ${result.passed} erfüllt, ${result.failed} nicht erfüllt, ` +
      `${result.undecidable} nicht entscheidbar (${result.thresholdDe})`
    )
  })
  lines.push(
    'Orientierende Prüfung anhand der im Modell veröffentlichten Werte — keine Rechtsauskunft ' +
      'und kein Nachweis. „Nicht entscheidbar“ heißt: das Modell führt den Wert nicht.'
  )
  return lines.join('\n')
}
