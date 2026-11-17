// Source of record: OIB-Richtlinien, Begriffsbestimmungen, Ausgabe Mai 2023.
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import type { DerivationRule } from './types'

export interface DerivationDefinition {
  rule: DerivationRule
  citation: string
  inputs: readonly string[]
}

export const BUILDING_CLASS_INPUTS = [
  'building_type',
  'building_position',
  'access_three_sides',
  'storeys_above_ground',
  'escape_level_m',
  'gfa_above_ground',
  'use_units',
  'units_over_400',
  'uses',
] as const
export type BuildingClassInput = (typeof BUILDING_CLASS_INPUTS)[number]

export const BUILDING_CLASS_DERIVATION: DerivationDefinition = {
  rule: 'building_class',
  citation: 'OIB-Richtlinien, Begriffsbestimmungen (Ausgabe Mai 2023), Gebäudeklassen',
  inputs: BUILDING_CLASS_INPUTS,
}

export type BuildingClass = 1 | 2 | 3 | 4 | 5

export type BuildingClassOutcome = BuildingClass | 'hochhaus'

type Outcome = BuildingClassOutcome | 'no_building'

export interface BuildingClassResult {
  value: BuildingClass | null
  hochhaus: boolean
  applicable: boolean
  missing: BuildingClassInput[]
}

export type BuildingClassInputs = Readonly<Record<string, ProjectPrimitiveValue | undefined>>

type Band = string | number | boolean

interface InputDomain {
  read: (raw: ProjectPrimitiveValue | undefined) => Band | undefined
  bands: readonly Band[]
}

const RESIDENTIAL_USES: readonly string[] = ['residential']

const BUILDING_POSITIONS: readonly string[] = ['freestanding', 'attached', 'terraced']

function readNumber(raw: ProjectPrimitiveValue | undefined): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readBoolean(raw: ProjectPrimitiveValue | undefined): boolean | undefined {
  if (typeof raw === 'boolean') return raw
  if (raw === 'yes') return true
  if (raw === 'no') return false
  return undefined
}

function readToken(raw: ProjectPrimitiveValue | undefined): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

function readPurelyResidential(raw: ProjectPrimitiveValue | undefined): boolean | undefined {
  const uses = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : []
  if (uses.length === 0) return undefined
  return uses.every((use) => RESIDENTIAL_USES.includes(use))
}

const INPUT_DOMAINS: Record<BuildingClassInput, InputDomain> = {
  building_type: { read: readToken, bands: ['building', 'other'] },
  building_position: {
    read: (raw) => {
      const token = readToken(raw)
      return token && BUILDING_POSITIONS.includes(token) ? token : undefined
    },
    bands: BUILDING_POSITIONS,
  },
  access_three_sides: { read: readBoolean, bands: [true, false] },
  storeys_above_ground: { read: readNumber, bands: [3, 4, 5] },
  escape_level_m: { read: readNumber, bands: [7, 11, 22, 23] },
  gfa_above_ground: { read: readNumber, bands: [400, 800, 801] },
  use_units: { read: readNumber, bands: [1, 2, 3] },
  units_over_400: { read: readBoolean, bands: [false, true] },
  uses: { read: readPurelyResidential, bands: [true, false] },
}

export function readBuildingClassInput(input: BuildingClassInput, raw: ProjectPrimitiveValue | undefined): Band | undefined {
  return INPUT_DOMAINS[input].read(raw)
}

interface Building {
  isBuilding: boolean
  position: string
  threeSidedAccess: boolean
  storeys: number
  escapeLevel: number
  grossFloorArea: number
  units: number
  unitOver400: boolean
  purelyResidential: boolean
}

function valueOf(values: readonly Band[], input: BuildingClassInput): Band {
  return values[BUILDING_CLASS_INPUTS.indexOf(input)]
}

function buildingFrom(values: readonly Band[]): Building {
  return {
    isBuilding: valueOf(values, 'building_type') === 'building',
    position: String(valueOf(values, 'building_position')),
    threeSidedAccess: valueOf(values, 'access_three_sides') === true,
    storeys: Number(valueOf(values, 'storeys_above_ground')),
    escapeLevel: Number(valueOf(values, 'escape_level_m')),
    grossFloorArea: Number(valueOf(values, 'gfa_above_ground')),
    units: Number(valueOf(values, 'use_units')),
    unitOver400: valueOf(values, 'units_over_400') === true,
    purelyResidential: valueOf(values, 'uses') === true,
  }
}

function isLow(b: Building): boolean {
  return b.storeys <= 3 && b.escapeLevel <= 7
}

function isDetachedAccessible(b: Building): boolean {
  return b.position === 'freestanding' && b.threeSidedAccess
}

function isBuildingClass1(b: Building): boolean {
  return isLow(b) && isDetachedAccessible(b) && b.grossFloorArea <= 400 && b.units <= 2
}

function isBuildingClass2(b: Building): boolean {
  if (!isLow(b)) return false
  const terracedHouse = b.position === 'terraced' && !b.unitOver400
  const detachedHouse = isDetachedAccessible(b) && b.purelyResidential && b.grossFloorArea <= 800
  return b.grossFloorArea <= 400 || terracedHouse || detachedHouse
}

function isBuildingClass4(b: Building): boolean {
  if (b.storeys > 4 || b.escapeLevel > 11) return false
  return b.units <= 1 || !b.unitOver400
}

function classify(values: readonly Band[]): Outcome {
  const b = buildingFrom(values)
  if (!b.isBuilding) return 'no_building'
  if (b.escapeLevel > 22) return 'hochhaus'
  if (isBuildingClass1(b)) return 1
  if (isBuildingClass2(b)) return 2
  if (isLow(b)) return 3
  if (isBuildingClass4(b)) return 4
  return 5
}

interface Scenario {
  values: readonly Band[]
  outcome: Outcome
}

interface OutcomeSpace {
  open: BuildingClassInput[]
  scenarios: Scenario[]
}

function outcomeSpace(inputs: BuildingClassInputs): OutcomeSpace {
  const open: BuildingClassInput[] = []
  let combinations: Band[][] = [[]]
  for (const input of BUILDING_CLASS_INPUTS) {
    const domain = INPUT_DOMAINS[input]
    const known = domain.read(inputs[input])
    if (known === undefined) open.push(input)
    const choices = known === undefined ? domain.bands : [known]
    combinations = combinations.flatMap((prefix) => choices.map((choice) => [...prefix, choice]))
  }
  return { open, scenarios: combinations.map((values) => ({ values, outcome: classify(values) })) }
}

function isDecisive(space: OutcomeSpace, input: BuildingClassInput): boolean {
  const index = BUILDING_CLASS_INPUTS.indexOf(input)
  const outcomeByRest = new Map<string, Outcome>()
  for (const { values, outcome } of space.scenarios) {
    const rest = values.map((value, at) => (at === index ? '*' : String(value))).join('|')
    const seen = outcomeByRest.get(rest)
    if (seen === undefined) outcomeByRest.set(rest, outcome)
    else if (seen !== outcome) return true
  }
  return false
}

export function possibleBuildingClasses(inputs: BuildingClassInputs): Set<BuildingClassOutcome> {
  const outcomes = new Set<BuildingClassOutcome>()
  for (const { outcome } of outcomeSpace(inputs).scenarios) {
    if (outcome !== 'no_building') outcomes.add(outcome)
  }
  return outcomes
}

export function decisiveInputs(inputs: BuildingClassInputs): BuildingClassInput[] {
  const space = outcomeSpace(inputs)
  return space.open.filter((input) => isDecisive(space, input))
}

export function deriveBuildingClass(inputs: BuildingClassInputs): BuildingClassResult {
  const space = outcomeSpace(inputs)
  const outcomes = new Set(space.scenarios.map((scenario) => scenario.outcome))
  const missing = space.open.filter((input) => isDecisive(space, input))
  if (outcomes.size !== 1) return { value: null, hochhaus: false, applicable: true, missing }
  const [outcome] = outcomes
  return {
    value: typeof outcome === 'number' ? outcome : null,
    hochhaus: outcome === 'hochhaus',
    applicable: outcome !== 'no_building',
    missing,
  }
}
