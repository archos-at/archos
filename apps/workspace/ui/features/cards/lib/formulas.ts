import type { AnswerCard } from '@/shared/cards/schemas'
import type { CalculationLimitData, CalculationStepData, DimStatus, NormReferenceData } from '@/shared/cards/schemas'
import { evaluate, resultDecimals, verdictFor, type Derivation, type StepDisplay, type StepResult } from './calculate'

export type FormulaCardData = Extract<AnswerCard, { type: 'formula' }>
export type FormulaSpec = FormulaCardData['formula']
export type FormulaName = FormulaSpec['name']
type Rule<N extends FormulaName> = Extract<FormulaSpec, { name: N }>
export type FormulaInputData = Rule<'stair_step_rule'>['riser']
export type StairType = Rule<'stair_step_rule'>['stair_type']
export type Component = Rule<'u_value'>['component']
export type RouteStart = Rule<'escape_route_length'>['start']
export type Measure = NonNullable<Rule<'u_value'>['measure']>
type HeatFlow = 'horizontal' | 'upward' | 'downward'

export type FormulaValues = Record<string, number | null>

export type InputLabel =
  | 'riser'
  | 'going'
  | 'thickness'
  | 'conductivity'
  | 'length'
  | 'openingArea'
  | 'floorArea'
  | 'roomDepth'
  | 'overhangDepth'

export interface InputSlot {
  key: string
  input: FormulaInputData
  unit: string
  labelKey: InputLabel
  group: string | null
  min: number | null
  max: number | null
  step: number | null
  positive: boolean
  editable: boolean
}

const EDITION = 'Ausgabe Mai 2023'
const oib = (guideline: string, section: string): NormReferenceData => ({
  document: `OIB-Richtlinie ${guideline}`,
  section,
  edition: EDITION,
  excerpt: null,
})

export const STEP_RULE = { lower: 59, upper: 65 } as const

export const STAIR_TABLE: Record<StairType, { riserMax: number; goingMin: number; row: string }> = {
  main: { riserMax: 18, goingMin: 27, row: 'Haupttreppen, ausgenommen Wohnungstreppen' },
  dwelling: { riserMax: 20, goingMin: 24, row: 'Wohnungstreppen' },
  secondary: { riserMax: 21, goingMin: 21, row: 'Nebentreppen' },
}

export const U_MAX_NEW_BUILD: Record<Component, { value: number; row: number; heatFlow: HeatFlow }> = {
  external_wall: { value: 0.35, row: 1, heatFlow: 'horizontal' },
  roof_or_ceiling_to_outside_air: { value: 0.2, row: 18, heatFlow: 'upward' },
  floor_over_outside_air: { value: 0.2, row: 22, heatFlow: 'downward' },
}

export const RENOVATION_FACTOR = 0.76

export const uValueBound = (component: Component, measure: Measure | null | undefined): number | null => {
  const row = U_MAX_NEW_BUILD[component]
  if (measure == null || measure === 'major_renovation') return null
  return measure === 'renovation' ? Number((row.value * RENOVATION_FACTOR).toFixed(6)) : row.value
}

export const SURFACE_RESISTANCE: Record<HeatFlow, { inside: number; outside: number }> = {
  horizontal: { inside: 0.13, outside: 0.04 },
  upward: { inside: 0.1, outside: 0.04 },
  downward: { inside: 0.17, outside: 0.04 },
}

export const ESCAPE_ROUTE_MAX = 40

export const DAYLIGHT = {
  base: 12,
  raised: 15,
  raisedFrom: 1.5,
  perOverhangMetre: 2,
  overhangFrom: 3,
  perDepthMetre: 1,
  depthFrom: 5,
} as const

export const FORMULA_SOURCES: Record<FormulaName, NormReferenceData> = {
  u_value: { document: 'ÖNORM EN ISO 6946', section: null, edition: 'EN ISO 6946:2017', excerpt: null },
  stair_step_rule: oib('4', 'Pkt. 3.2.1'),
  escape_route_length: oib('2', 'Pkt. 5.1.1'),
  daylight_ratio: oib('3', 'Pkt. 9.1'),
}

const EPSILON = 1e-9

export const startedMetres = (value: number, from: number): number => {
  const beyond = value - from
  return beyond <= EPSILON * Math.max(1, from) ? 0 : Math.ceil(beyond - EPSILON)
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const boundsOf = (input: FormulaInputData): { min: number | null; max: number | null } => {
  const value = finite(input.value)
  let min = finite(input.min)
  let max = finite(input.max)
  if (min != null && max != null && min >= max) {
    min = null
    max = null
  }
  if (value != null && min != null && value < min) min = null
  if (value != null && max != null && value > max) max = null
  const lowest = Math.max(0, min ?? 0)
  return { min: value != null && value < lowest ? null : lowest, max }
}

const slot = (
  key: string,
  input: FormulaInputData,
  unit: string,
  labelKey: InputLabel,
  group: string | null = null,
  positive = false
): InputSlot => {
  const step = finite(input.step)
  return {
    key,
    input,
    unit,
    labelKey,
    group,
    ...boundsOf(input),
    step: step != null && step > 0 ? step : null,
    positive,
    editable: input.editable !== false,
  }
}

const CM = 'cm'
const M = 'm'
const M2 = 'm²'
const LAMBDA = 'W/(m·K)'
const RESISTANCE = 'm²K/W'
const U = 'W/(m²K)'
const PERCENT = '%'

export function inputSlots(formula: FormulaSpec): InputSlot[] {
  switch (formula.name) {
    case 'stair_step_rule':
      return [slot('riser', formula.riser, CM, 'riser'), slot('going', formula.going, CM, 'going')]
    case 'escape_route_length':
      return formula.segments.map((segment, index) =>
        slot(`segments.${index}.length`, segment.length, M, 'length', segment.label)
      )
    case 'daylight_ratio':
      return [
        slot('opening_area', formula.opening_area, M2, 'openingArea'),
        slot('floor_area', formula.floor_area, M2, 'floorArea', null, true),
        slot('room_depth', formula.room_depth, M, 'roomDepth'),
        slot('overhang_depth', formula.overhang_depth, M, 'overhangDepth'),
      ]
    case 'u_value':
      return formula.layers.flatMap((layer, index) => [
        slot(`layers.${index}.thickness`, layer.thickness, CM, 'thickness', layer.label),
        slot(`layers.${index}.conductivity`, layer.conductivity, LAMBDA, 'conductivity', layer.label, true),
      ])
  }
}

export function sourceValues(formula: FormulaSpec): FormulaValues {
  return Object.fromEntries(inputSlots(formula).map((entry) => [entry.key, finite(entry.input.value)]))
}

export function changedInputs(source: FormulaValues, current: FormulaValues): Set<string> {
  return new Set(Object.keys(source).filter((key) => !Object.is(source[key], current[key] ?? null)))
}

export type LineKey =
  | 'layerResistance'
  | 'totalResistance'
  | 'uValue'
  | 'stepMeasure'
  | 'routeLength'
  | 'daylightShare'
  | 'requiredShare'

export type TermKey =
  | InputLabel
  | 'surfaceInside'
  | 'surfaceOutside'
  | 'layerResistance'
  | 'totalResistance'
  | 'baseShare'
  | 'raisedShare'
  | 'overhangIncrement'
  | 'depthIncrement'

export interface FormulaWords {
  line(key: LineKey, group?: string | null): string
  term(key: TermKey, params?: { group?: string | null; metres?: number }): string
}

export type CheckId = 'stepRule' | 'riserMax' | 'goingMin' | 'uMax' | 'uMaxRenovation' | 'routeMax' | 'daylightMin'

export interface CheckSpec {
  id: CheckId
  quantity: { kind: 'step'; index: number } | { kind: 'input'; key: string }
  unit: string
  limit: CalculationLimitData
  boundStep?: number
  reference: NormReferenceData
  dependsOn: string[]
  unknownCase?: 'measure' | 'majorRenovation'
}

export type CaveatKey =
  | 'uValueNewBuild'
  | 'uValueRenovation'
  | 'uValueMeasureUnknown'
  | 'uValueMajorRenovation'
  | 'uValueScope'
  | 'routeFromRoom'
  | 'routeFromDwelling'
  | 'routeOnlyGuideline2'
  | 'daylightRoomsOnly'
  | 'daylightAngle'
  | 'daylightOtherLaw'
  | 'daylightWinterGarden'

export interface CompiledFormula {
  steps: CalculationStepData[]
  display: StepDisplay[]
  checks: CheckSpec[]
  caveats: Array<{ key: CaveatKey; params?: Record<string, string> }>
  tint: CheckId
  zeroInput?: InputLabel
}

const at = (values: FormulaValues, key: string): number | null => finite(values[key])

function compileStair(formula: Rule<'stair_step_rule'>, values: FormulaValues, words: FormulaWords): CompiledFormula {
  const row = STAIR_TABLE[formula.stair_type]
  const table = oib('4', `Pkt. 3.2.1, Tabelle 3: ${row.row}`)
  return {
    steps: [
      {
        label: words.line('stepMeasure'),
        operation: 'sum',
        unit: CM,
        operands: [
          { label: words.term('riser'), value: at(values, 'riser'), unit: CM, factor: 2 },
          { label: words.term('going'), value: at(values, 'going'), unit: CM },
        ],
      },
    ],
    display: [{ decimals: 2 }],
    checks: [
      {
        id: 'stepRule',
        quantity: { kind: 'step', index: 0 },
        unit: CM,
        limit: { comparator: 'between', value: STEP_RULE.lower, upper: STEP_RULE.upper },
        reference: oib('4', 'Pkt. 3.2.1'),
        dependsOn: ['riser', 'going'],
      },
      {
        id: 'riserMax',
        quantity: { kind: 'input', key: 'riser' },
        unit: CM,
        limit: { comparator: '<=', value: row.riserMax },
        reference: table,
        dependsOn: ['riser'],
      },
      {
        id: 'goingMin',
        quantity: { kind: 'input', key: 'going' },
        unit: CM,
        limit: { comparator: '>=', value: row.goingMin },
        reference: table,
        dependsOn: ['going'],
      },
    ],
    caveats: [],
    tint: 'stepRule',
  }
}

function compileRoute(
  formula: Rule<'escape_route_length'>,
  values: FormulaValues,
  words: FormulaWords
): CompiledFormula {
  const keys = formula.segments.map((_, index) => `segments.${index}.length`)
  const fromDwelling = formula.start === 'dwelling_entrance'
  return {
    steps: [
      {
        label: words.line('routeLength'),
        operation: 'sum',
        unit: M,
        operands: formula.segments.map((segment, index) => ({
          label: words.term('length', { group: segment.label }),
          value: at(values, keys[index]),
          unit: M,
        })),
      },
    ],
    display: [{ decimals: 2 }],
    checks: [
      {
        id: 'routeMax',
        quantity: { kind: 'step', index: 0 },
        unit: M,
        limit: { comparator: '<=', value: ESCAPE_ROUTE_MAX },
        reference: oib('2', fromDwelling ? 'Pkt. 5.1.1 und 5.1.2' : 'Pkt. 5.1.1'),
        dependsOn: keys,
      },
    ],
    caveats: [{ key: fromDwelling ? 'routeFromDwelling' : 'routeFromRoom' }, { key: 'routeOnlyGuideline2' }],
    tint: 'routeMax',
  }
}

export function requiredShareTerms(
  overhang: number | null,
  depth: number | null
): { base: number | null; raised: boolean; overhangMetres: number | null; depthMetres: number | null } {
  const raised = overhang != null && overhang > DAYLIGHT.raisedFrom + EPSILON
  return {
    base: overhang == null ? null : raised ? DAYLIGHT.raised : DAYLIGHT.base,
    raised,
    overhangMetres: overhang == null ? null : startedMetres(overhang, DAYLIGHT.overhangFrom),
    depthMetres: depth == null ? null : startedMetres(depth, DAYLIGHT.depthFrom),
  }
}

function compileDaylight(formula: Rule<'daylight_ratio'>, values: FormulaValues, words: FormulaWords): CompiledFormula {
  const terms = requiredShareTerms(at(values, 'overhang_depth'), at(values, 'room_depth'))
  const steps: CalculationStepData[] = [
    {
      label: words.line('daylightShare'),
      operation: 'percent_ratio',
      unit: PERCENT,
      operands: [
        { label: words.term('openingArea'), value: at(values, 'opening_area'), unit: M2 },
        { label: words.term('floorArea'), value: at(values, 'floor_area'), unit: M2 },
      ],
    },
  ]
  const display: StepDisplay[] = [{ decimals: 2 }]

  const known = terms.base != null && terms.depthMetres != null && terms.overhangMetres != null
  const increments = (terms.overhangMetres ?? 0) + (terms.depthMetres ?? 0)
  let boundStep: number | undefined
  if (!known || increments > 0) {
    const operands: CalculationStepData['operands'] = [
      { label: words.term(terms.raised ? 'raisedShare' : 'baseShare'), value: terms.base, unit: PERCENT },
    ]
    if (terms.overhangMetres == null || terms.overhangMetres > 0) {
      operands.push({
        label: words.term('overhangIncrement', { metres: terms.overhangMetres ?? undefined }),
        value: terms.overhangMetres == null ? null : terms.overhangMetres * DAYLIGHT.perOverhangMetre,
        unit: PERCENT,
      })
    }
    if (terms.depthMetres == null || terms.depthMetres > 0) {
      operands.push({
        label: words.term('depthIncrement', { metres: terms.depthMetres ?? undefined }),
        value: terms.depthMetres == null ? null : terms.depthMetres * DAYLIGHT.perDepthMetre,
        unit: PERCENT,
      })
    }
    steps.unshift({ label: words.line('requiredShare'), operation: 'sum', unit: PERCENT, operands })
    display.unshift({ decimals: 2 })
    boundStep = 0
  }
  const shareIndex = steps.length - 1
  return {
    steps,
    display,
    checks: [
      {
        id: 'daylightMin',
        quantity: { kind: 'step', index: shareIndex },
        unit: PERCENT,
        limit: { comparator: '>=', value: terms.base ?? DAYLIGHT.base },
        boundStep,
        reference: oib('3', 'Pkt. 9.1.1, 9.1.3 und 9.1.4'),
        dependsOn: ['opening_area', 'floor_area', 'room_depth', 'overhang_depth'],
      },
    ],
    caveats: [
      { key: 'daylightRoomsOnly' },
      { key: 'daylightAngle' },
      ...((terms.depthMetres ?? 0) > 0 ? [{ key: 'daylightOtherLaw' as const }] : []),
      { key: 'daylightWinterGarden' },
    ],
    tint: 'daylightMin',
    zeroInput: 'floorArea',
  }
}

function compileUValue(formula: Rule<'u_value'>, values: FormulaValues, words: FormulaWords): CompiledFormula {
  const row = U_MAX_NEW_BUILD[formula.component]
  const surface = SURFACE_RESISTANCE[row.heatFlow]
  const layerSteps: CalculationStepData[] = formula.layers.map((layer, index) => {
    const thickness = at(values, `layers.${index}.thickness`)
    return {
      label: words.line('layerResistance', layer.label),
      operation: 'quotient',
      unit: RESISTANCE,
      operands: [
        { label: words.term('thickness', { group: layer.label }), value: thickness == null ? null : thickness / 100, unit: M },
        { label: words.term('conductivity', { group: layer.label }), value: at(values, `layers.${index}.conductivity`), unit: LAMBDA },
      ],
    }
  })
  const total: CalculationStepData = {
    label: words.line('totalResistance'),
    operation: 'sum',
    unit: RESISTANCE,
    operands: [
      { label: words.term('surfaceInside'), value: surface.inside, unit: RESISTANCE },
      ...formula.layers.map((layer, index) => ({
        label: words.term('layerResistance', { group: layer.label }),
        step: index + 1,
      })),
      { label: words.term('surfaceOutside'), value: surface.outside, unit: RESISTANCE },
    ],
  }
  const transmittance: CalculationStepData = {
    label: words.line('uValue'),
    operation: 'quotient',
    unit: U,
    operands: [
      { label: '', value: 1 },
      { label: words.term('totalResistance'), step: formula.layers.length + 1 },
    ],
  }
  const keys = formula.layers.flatMap((_, index) => [`layers.${index}.thickness`, `layers.${index}.conductivity`])
  const measure = formula.measure ?? null
  const bound = uValueBound(formula.component, measure)
  const section =
    measure === 'renovation' ? `Pkt. 4.5 b) mit Pkt. 4.4.1, Zeile ${row.row}` : `Pkt. 4.4.1, Zeile ${row.row}`
  const MEASURE_CAVEAT: Record<Measure, CaveatKey> = {
    new_build: 'uValueNewBuild',
    renovation: 'uValueRenovation',
    major_renovation: 'uValueMajorRenovation',
  }
  const measureCaveat: CaveatKey = measure ? MEASURE_CAVEAT[measure] : 'uValueMeasureUnknown'
  return {
    steps: [...layerSteps, total, transmittance],
    display: [...layerSteps.map(() => ({ decimals: 4, fixed: true })), { decimals: 4, fixed: true }, { decimals: 3 }],
    checks: [
      {
        id: measure === 'renovation' ? 'uMaxRenovation' : 'uMax',
        quantity: { kind: 'step', index: formula.layers.length + 1 },
        unit: U,
        limit: { comparator: '<=', value: bound ?? row.value },
        reference: oib('6', section),
        dependsOn: keys,
        ...(bound == null ? { unknownCase: measure === 'major_renovation' ? ('majorRenovation' as const) : ('measure' as const) } : {}),
      },
    ],
    caveats: [{ key: measureCaveat, params: { row: String(row.row) } }, { key: 'uValueScope' }],
    tint: measure === 'renovation' ? 'uMaxRenovation' : 'uMax',
    zeroInput: 'conductivity',
  }
}

export function compileFormula(formula: FormulaSpec, values: FormulaValues, words: FormulaWords): CompiledFormula {
  switch (formula.name) {
    case 'stair_step_rule':
      return compileStair(formula, values, words)
    case 'escape_route_length':
      return compileRoute(formula, values, words)
    case 'daylight_ratio':
      return compileDaylight(formula, values, words)
    case 'u_value':
      return compileUValue(formula, values, words)
  }
}

export type SiteBinding = NonNullable<FormulaCardData['site_binding']>

export type HoldReason = 'siteUnknown' | 'unsettled' | 'unavailable' | 'notBinding' | 'otherEdition'

const COVERAGE_HOLD = {
  unsettled: 'unsettled',
  site_unknown: 'siteUnknown',
  unavailable: 'unavailable',
} as const satisfies Record<Exclude<SiteBinding['coverage'], 'settled'>, HoldReason>

export interface EditionHold {
  reason: HoldReason
  edition: string
  binding: string | null
}

export function editionHold(reference: NormReferenceData, site: SiteBinding | null | undefined): EditionHold | null {
  const edition = reference.edition ?? ''
  const hold = (reason: HoldReason, binding: string | null = null): EditionHold => ({ reason, edition, binding })
  if (!site) return null
  if (site.coverage !== 'settled') return hold(COVERAGE_HOLD[site.coverage])
  const binds = site.editions?.find((entry) => entry.designation === reference.document)
  if (!binds) return hold(site.truncated ? 'siteUnknown' : 'notBinding')
  if (binds.scope_unsettled) return hold('unsettled')
  if (!binds.edition_label) return hold('siteUnknown')
  return binds.edition_label === edition ? null : hold('otherEdition', binds.edition_label)
}

export interface LimitCheck {
  spec: CheckSpec
  quantity: StepResult
  limit: CalculationLimitData | null
  status: DimStatus
  decimals: number
  hold: EditionHold | null
}

export interface JudgedFormula {
  results: Derivation
  checks: LimitCheck[]
  display: StepDisplay[]
}

const inputResult = (value: number | null, unit: string): StepResult => ({
  value,
  tolerance: null,
  unit,
  undecidable: value == null ? 'missing' : null,
})

export function judgeFormula(
  compiled: CompiledFormula,
  values: FormulaValues,
  site: SiteBinding | null | undefined
): JudgedFormula {
  const results = evaluate(compiled.steps)
  const checks = compiled.checks.map((spec): LimitCheck => {
    const hold = editionHold(spec.reference, site)
    const quantity =
      spec.quantity.kind === 'step' ? results[spec.quantity.index] : inputResult(at(values, spec.quantity.key), spec.unit)
    const derived = spec.boundStep == null ? undefined : results[spec.boundStep]
    const limit = spec.unknownCase
      ? null
      : derived === undefined
        ? spec.limit
        : derived.value == null
          ? null
          : { ...spec.limit, value: derived.value }
    if (limit == null) return { spec, quantity, limit, status: 'needs_input', decimals: 2, hold }
    const status = verdictFor(quantity, limit) ?? 'needs_input'
    return { spec, quantity, limit, status, decimals: resultDecimals(quantity, limit), hold }
  })
  const display = compiled.display.map((entry, index) => {
    const needed = checks
      .filter((check) => check.spec.quantity.kind === 'step' && check.spec.quantity.index === index)
      .map((check) => check.decimals)
    return needed.length > 0 ? { ...entry, decimals: Math.max(entry.decimals, ...needed) } : entry
  })
  return { results, checks, display }
}
