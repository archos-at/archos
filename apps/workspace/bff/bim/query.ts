import 'server-only'
import { and, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { likeContains } from '@/lib/text/like-pattern'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { bimElements } from '@/lib/db/schema/bim'
import { internalRead } from '@/lib/documents/document-reader'
import {
  aggregateBimElements,
  countBimElementsByType,
  findBimElement,
  findBimModelById,
  listBimElements,
  loadBimElementsForComparison,
  loadBimElementsForSchedule,
  listBimPropertyCatalog,
  type BimElementListRow,
  type BimGroupedCount,
  type BimModelHeader,
  type BimElementQueryPlan,
  type BimPropertyCatalogEntry,
} from './repository'
import { complianceRun, contextOfModel } from './compliance-run'
import { compareModels, renderComparison, type BimComparison } from './compare'
import { deriveProfileSuggestions, renderProfileSuggestions, type BimProfileSuggestion } from './profile'
import {
  diffBimCompliance,
  renderBimComplianceDiff,
  ifcTypeVariants,
  renderBimRules,
  type BimComplianceChange,
  type BimComplianceSummary,
  type BimRuleResult,
} from './rules'
import {
  buildQuantityTakeoff,
  buildRoomSchedule,
  type BimQuantityRow,
  type BimRoomSchedule,
} from './schedule'
import { healthCaveat, type BimHealth } from './validate'
import { BIM_ELEMENT_OFFSET_LIMIT, BIM_ELEMENTS_PAGE_LIMIT } from './types'
import type { BimModelSummary, BimUnits } from './types'

export const BIM_FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'missing',
] as const
export type BimFilterOperator = (typeof BIM_FILTER_OPERATORS)[number]

const NUMERIC_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte'])

const propertyFilterSchema = z
  .object({
    set: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(120),
    operator: z.enum(BIM_FILTER_OPERATORS).default('eq'),
    value: z.union([z.string().max(400), z.number(), z.boolean()]).optional(),
    source: z.enum(['property', 'quantity']).default('property'),
  })
  .strict()
  .refine(
    (filter) =>
      filter.operator === 'exists' || filter.operator === 'missing' || filter.value !== undefined,
    { message: 'operator requires a value' }
  )
  .refine(
    (filter) => !NUMERIC_OPERATORS.has(filter.operator) || Number.isFinite(Number(filter.value)),
    {
      message: 'gt/gte/lt/lte need a numeric value',
    }
  )

export type BimPropertyFilter = z.infer<typeof propertyFilterSchema>

export const BIM_MAIN_USE = [
  'residential',
  'office',
  'lodging',
  'assembly',
  'healthcare',
  'agriculture',
  'manufacturing',
  'storage',
  'other',
] as const

export const canonicalBimMainUse = (value: unknown): unknown =>
  typeof value === 'string' ? normalizeProfileToken('main_use', value) : value

export type BimMainUse = (typeof BIM_MAIN_USE)[number]

export const bimFilterSchema = z.object({
  ifcTypes: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  storeys: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  nameContains: z.string().trim().min(1).max(200).optional(),
  material: z.string().trim().min(1).max(200).optional(),
  classification: z.string().trim().min(1).max(200).optional(),
  globalIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  properties: z.array(propertyFilterSchema).max(10).optional(),
})
  .strict()

export type BimFilter = z.infer<typeof bimFilterSchema>

export const BIM_GROUP_BY = [
  'ifcType',
  'storey',
  'predefinedType',
  'typeName',
  'material',
  'property',
] as const
export type BimGroupBy = (typeof BIM_GROUP_BY)[number]

export const BIM_METRICS = ['count', 'sum', 'avg', 'min', 'max'] as const

const aggregateSchema = z.object({
  op: z.literal('aggregate'),
  filter: bimFilterSchema.default({}),
  metric: z.enum(BIM_METRICS).default('count'),
  quantity: z.string().trim().min(1).max(120).optional(),
  quantitySet: z.string().trim().min(1).max(120).optional(),
  groupBy: z.enum(BIM_GROUP_BY).optional(),
  groupProperty: z
    .object({ set: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(120) })
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict()

const bimQueryObjectSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('overview') }).strict(),
  z.object({ op: z.literal('health') }).strict(),
  z.object({ op: z.literal('schedule') }).strict(),
  z.object({
    op: z.literal('compliance'),
    buildingClass: z.number().int().min(1).max(5).nullish(),
    mainUse: z.preprocess(canonicalBimMainUse, z.enum(BIM_MAIN_USE).nullish()),
  }).strict(),
  z.object({
    op: z.literal('compliance-diff'),
    baseModelId: z.guid().optional(),
    buildingClass: z.number().int().min(1).max(5).nullish(),
    mainUse: z.preprocess(canonicalBimMainUse, z.enum(BIM_MAIN_USE).nullish()),
  }).strict(),
  z.object({ op: z.literal('profile') }).strict(),
  z.object({
    op: z.literal('takeoff'),
    quantity: z.string().trim().min(1).max(120).default('NetSideArea'),
    byMaterial: z.boolean().default(false),
    filter: bimFilterSchema.default({}),
  }).strict(),
  z.object({
    op: z.literal('compare'),
    baseModelId: z.guid().optional(),
    limit: z.number().int().min(100).max(50_000).default(20_000),
  }).strict(),
  z.object({ op: z.literal('types') }).strict(),
  z.object({
    op: z.literal('elements'),
    filter: bimFilterSchema.default({}),
    limit: z.number().int().min(1).max(BIM_ELEMENTS_PAGE_LIMIT).default(25),
    offset: z.number().int().min(0).max(BIM_ELEMENT_OFFSET_LIMIT).default(0),
  }).strict(),
  z.object({ op: z.literal('element'), globalId: z.string().trim().min(1).max(64) }).strict(),
  z.object({
    op: z.literal('properties'),
    ifcType: z.string().trim().min(1).max(80).optional(),
    maxValues: z.number().int().min(1).max(50).default(10),
  }).strict(),
  aggregateSchema,
]).superRefine((request, ctx) => {
  if (request.op === 'aggregate' && request.groupBy === 'property' && !request.groupProperty) {
    ctx.addIssue({
      code: 'custom',
      path: ['groupProperty'],
      message: 'groupBy "property" needs groupProperty {set, name}',
    })
  }
})

const LEGACY_BIM_FACT_NAMES = { gebaeudeklasse: 'buildingClass', hauptnutzung: 'mainUse' } as const

export function renameLegacyBimFactNames(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const [oldName, newName] of Object.entries(LEGACY_BIM_FACT_NAMES)) {
    if (!(oldName in next)) continue
    if (!(newName in next)) next[newName] = next[oldName]
    delete next[oldName]
  }
  return next
}

export const bimQuerySchema = z.preprocess(renameLegacyBimFactNames, bimQueryObjectSchema)

export type BimQuery = z.infer<typeof bimQueryObjectSchema>

export interface BimQueryResult {
  op: BimQuery['op']
  model: {
    id: string
    filename: string
    schema: string | null
    elementCount: number
  }
  summary: string
  overview?: BimModelSummary
  health?: BimHealth
  caveat?: string | null
  comparison?: BimComparison
  schedule?: BimRoomSchedule
  compliance?: BimRuleResult[]
  complianceSummary?: BimComplianceSummary
  complianceChanges?: BimComplianceChange[]
  comparedWith?: string
  complianceShoppingList?: Array<{ path: string; elements: number; rules: string[] }>
  takeoff?: BimQuantityRow[]
  profileSuggestions?: BimProfileSuggestion[]
  types?: Array<{ ifcType: string; elements: number }>
  elements?: BimElementListRow[]
  element?: Awaited<ReturnType<typeof findBimElement>>
  properties?: BimPropertyCatalogEntry[]
  propertyScan?: { scanned: number; total: number; complete: boolean }
  groups?: BimGroupedCount[]
  units?: BimUnits
  total?: number
  totalIsLowerBound?: boolean
  truncated?: boolean
}

export class BimModelNotReadyError extends ApiError {
  readonly modelStatus: BimModelHeader['status']

  constructor(status: BimModelHeader['status'], message: string) {
    super(
      status === 'failed' && /not found/i.test(message) ? 404 : 409,
      'MODEL_NOT_READY',
      message
    )
    this.name = 'BimModelNotReadyError'
    this.modelStatus = status
  }
}

function unnestedProperties(source: 'property' | 'quantity'): SQL {
  const column = source === 'quantity' ? bimElements.quantities : bimElements.properties
  return sql`jsonb_each(${column}) AS s(set_name, set_value), jsonb_each(s.set_value) AS p(prop_name, prop_value)`
}

function valueCondition(filter: BimPropertyFilter): SQL | null {
  const asText = sql`p.prop_value #>> '{}'`
  switch (filter.operator) {
    case 'exists':
    case 'missing':
      return null
    case 'eq':
      return typeof filter.value === 'number'
        ? numericCondition(sql`=`, filter.value)
        : sql`lower(${asText}) = lower(${String(filter.value)})`
    case 'neq':
      return typeof filter.value === 'number'
        ? // NOT the numeric-equal condition, rather than a `<>`: an element
          sql`NOT (CASE WHEN jsonb_typeof(p.prop_value) = 'number' THEN (p.prop_value)::numeric = ${filter.value} ELSE false END)`
        : sql`lower(${asText}) IS DISTINCT FROM lower(${String(filter.value)})`
    case 'contains':
      return sql`${asText} ILIKE ${likeContains(String(filter.value))}`
    case 'gt':
      return numericCondition(sql`>`, Number(filter.value))
    case 'gte':
      return numericCondition(sql`>=`, Number(filter.value))
    case 'lt':
      return numericCondition(sql`<`, Number(filter.value))
    case 'lte':
      return numericCondition(sql`<=`, Number(filter.value))
  }
}

function numericCondition(operator: SQL, value: number): SQL {
  if (!Number.isFinite(value)) return sql`false`
  return sql`CASE WHEN jsonb_typeof(p.prop_value) = 'number' THEN (p.prop_value)::numeric ${operator} ${value} ELSE false END`
}

function searchKeyPrefilter(filter: BimPropertyFilter): SQL | null {
  if (filter.operator === 'missing' || filter.operator === 'neq') return null
  const prefix = filter.source === 'quantity' ? 'q:' : 'p:'
  const key = filter.set
    ? `${prefix}${filter.set.toLowerCase()}.${filter.name.toLowerCase()}`
    : `${prefix}${filter.name.toLowerCase()}`

  return filter.operator === 'eq' && typeof filter.value === 'string'
    ? sql`${bimElements.searchKeys} @> ${JSON.stringify({ [key]: [filter.value.toLowerCase()] })}::jsonb`
    : sql`${bimElements.searchKeys} ? ${key}`
}

function propertyPredicate(filter: BimPropertyFilter, searchKeysIndexed: boolean): SQL {
  const conditions: SQL[] = [sql`lower(p.prop_name) = lower(${filter.name})`]
  if (filter.set) conditions.push(sql`lower(s.set_name) = lower(${filter.set})`)
  const value = valueCondition(filter)
  if (value) conditions.push(sql`(${value})`)

  const body = sql`SELECT 1 FROM ${unnestedProperties(filter.source)} WHERE ${sql.join(conditions, sql` AND `)}`
  const exact = filter.operator === 'missing' ? sql`NOT EXISTS (${body})` : sql`EXISTS (${body})`

  const prefilter = searchKeysIndexed ? searchKeyPrefilter(filter) : null
  return prefilter ? sql`(${prefilter} AND ${exact})` : exact
}

export function buildBimPredicate(
  filter: BimFilter | undefined,
  options: { searchKeysIndexed: boolean } = { searchKeysIndexed: false }
): SQL | undefined {
  return buildBimElementPlan(filter, options).assisted
}

const IFC_GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/

function sharedConditions(filter: BimFilter): SQL[] {
  const conditions: Array<SQL | undefined> = []

  if (filter.ifcTypes?.length) {
    conditions.push(
      inArray(
        sql`lower(${bimElements.ifcType})`,
        [...new Set(filter.ifcTypes.flatMap(ifcTypeVariants))]
      )
    )
  }
  if (filter.storeys?.length) {
    const lowered = filter.storeys.map((storey) => storey.toLowerCase())
    const byName = inArray(sql`lower(${bimElements.storeyName})`, lowered)
    const globalIds = lowered.filter((storey) => IFC_GLOBAL_ID.test(storey))
    conditions.push(
      globalIds.length === 0
        ? byName
        : or(byName, inArray(sql`lower(${bimElements.storeyGlobalId})`, globalIds))
    )
  }
  if (filter.globalIds?.length) {
    conditions.push(inArray(bimElements.globalId, filter.globalIds))
  }
  if (filter.nameContains) {
    conditions.push(ilike(bimElements.name, likeContains(filter.nameContains)))
  }
  if (filter.material) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${bimElements.materials}) AS m(name) WHERE m.name ILIKE ${likeContains(filter.material)})`
    )
  }
  if (filter.classification) {
    const pattern = likeContains(filter.classification)
    conditions.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${bimElements.classifications}) AS c(entry) WHERE (c.entry ->> 'identification') ILIKE ${pattern} OR (c.entry ->> 'name') ILIKE ${pattern} OR (c.entry ->> 'system') ILIKE ${pattern})`
    )
  }

  return conditions.filter((condition): condition is SQL => condition !== undefined)
}

const join = (conditions: SQL[]): SQL | undefined =>
  conditions.length === 0 ? undefined : and(...conditions)

export function buildBimElementPlan(
  filter: BimFilter | undefined,
  options: { searchKeysIndexed: boolean } = { searchKeysIndexed: false }
): BimElementQueryPlan {
  if (!filter) return { assisted: undefined, unassisted: undefined, candidates: null }

  const shared = sharedConditions(filter)
  const properties = filter.properties ?? []
  const prefilters = options.searchKeysIndexed
    ? properties.map(searchKeyPrefilter).filter((condition): condition is SQL => condition !== null)
    : []

  return {
    assisted: join([
      ...shared,
      ...properties.map((property) => propertyPredicate(property, options.searchKeysIndexed)),
    ]),
    unassisted: join([
      ...shared,
      ...properties.map((property) => propertyPredicate(property, false)),
    ]),
    candidates: prefilters.length === 0 ? null : join([...shared, ...prefilters]),
  }
}

function groupExpression(
  groupBy: BimGroupBy | undefined,
  groupProperty: { set: string; name: string } | undefined
): SQL | null {
  switch (groupBy) {
    case undefined:
      return null
    case 'ifcType':
      return sql`${bimElements.ifcType}`
    case 'storey':
      return sql`${bimElements.storeyName}`
    case 'predefinedType':
      return sql`${bimElements.predefinedType}`
    case 'typeName':
      return sql`${bimElements.typeName}`
    case 'material':
      return sql`${bimElements.materials} ->> 0`
    case 'property':
      return groupProperty ? groupPropertyExpression(groupProperty) : null
  }
}

function groupPropertyExpression(groupProperty: { set: string; name: string }): SQL {
  const conditions: SQL[] = [sql`lower(p.prop_name) = lower(${groupProperty.name})`]
  if (groupProperty.set) conditions.push(sql`lower(s.set_name) = lower(${groupProperty.set})`)
  return sql`(SELECT p.prop_value #>> '{}' FROM ${unnestedProperties('property')} WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1)`
}

function quantityExpression(quantity: string, quantitySet: string | undefined): SQL {
  const conditions: SQL[] = [
    sql`lower(p.prop_name) = lower(${quantity})`,
    sql`jsonb_typeof(p.prop_value) = 'number'`,
  ]
  if (quantitySet) conditions.push(sql`lower(s.set_name) = lower(${quantitySet})`)
  return sql`(SELECT (p.prop_value)::numeric FROM ${unnestedProperties('quantity')} WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1)`
}

function metricValueExpression(request: z.infer<typeof aggregateSchema>): SQL | null {
  if (request.metric === 'count' || !request.quantity) return null
  return quantityExpression(request.quantity, request.quantitySet)
}

function metricExpression(request: z.infer<typeof aggregateSchema>): SQL | null {
  if (request.metric === 'count' || !request.quantity) return null
  const value = quantityExpression(request.quantity, request.quantitySet)
  switch (request.metric) {
    case 'sum':
      return sql`sum(${value})`
    case 'avg':
      return sql`avg(${value})`
    case 'min':
      return sql`min(${value})`
    case 'max':
      return sql`max(${value})`
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function quantityUnit(
  request: BimQuery,
  units: BimUnits | undefined
): string {
  if (request.op !== 'aggregate' || request.metric === 'count' || !request.quantity) return ''
  if (!units) return ''
  const name = request.quantity.toLowerCase()
  const unit = name.includes('area')
    ? units.area
    : name.includes('volume')
      ? units.volume
      : /length|width|height|perimeter|depth|thickness/.test(name)
        ? units.length
        : null
  return unit?.symbol ? ` ${unit.symbol}` : ''
}

function renderSummary(request: BimQuery, result: Omit<BimQueryResult, 'summary'>): string {
  switch (request.op) {
    case 'overview': {
      const overview = result.overview
      if (!overview) return 'Keine Modellzusammenfassung vorhanden.'
      const parts = [
        `Modell „${overview.projectName ?? result.model.filename}“ (${overview.schema ?? 'IFC'})`,
        `${overview.totals.elements} Bauteile`,
        `${overview.totals.storeys} Geschoße`,
        `${overview.totals.spaces} Räume`,
      ]
      if (overview.quantityTotals.netFloorAreaM2 !== null) {
        parts.push(
          `Netto-Grundfläche ${formatNumber(overview.quantityTotals.netFloorAreaM2)} ${overview.units.area?.symbol ?? 'm²'}`
        )
      }
      return `${parts.join(', ')}.`
    }
    case 'health': {
      const health = result.health
      if (!health) return 'Für dieses Modell liegt keine Prüfung vor.'
      if (health.issues.length === 0) return 'Modellprüfung: keine Auffälligkeiten.'
      const rendered = health.issues
        .map((issue) => {
          const scope = issue.total === null ? `${issue.count}` : `${issue.count}/${issue.total}`
          const detail = issue.detail ? ` ${issue.detail}` : ''
          return `${issue.rule}${detail} (${issue.severity}, ${scope})`
        })
        .join('; ')
      return `Modellprüfung ${health.score}/100 — ${rendered}.`
    }
    case 'schedule': {
      const schedule = result.schedule
      if (!schedule) return 'Für dieses Modell liegt kein Raumbuch vor.'
      const missing =
        schedule.totals.roomsWithoutArea > 0
          ? ` ${schedule.totals.roomsWithoutArea} Räume ohne Flächenangabe sind darin NICHT enthalten.`
          : ''
      return (
        `Raumbuch: ${schedule.totals.rooms} Räume in ${schedule.storeys.length} Geschoßen, ` +
        `Netto-Grundfläche ${schedule.totals.netFloorArea ?? '—'} ${schedule.units.area}.${missing}`
      )
    }
    case 'takeoff': {
      const rows = result.takeoff ?? []
      if (rows.length === 0) return 'Keine Bauteile für diese Massenermittlung.'
      return `Massenermittlung (${request.quantity}): ${rows
        .slice(0, 20)
        .map(
          (row) =>
            `${row.group}: ${row.value ?? '—'} (${row.elements} Bauteile${row.missing > 0 ? `, ${row.missing} ohne Wert` : ''})`
        )
        .join('; ')}.`
    }
    case 'compliance':
      return renderBimRules(result.compliance ?? [])
    case 'compliance-diff':
      return (
        `Statusänderungen gegenüber ${result.comparedWith ?? 'dem Vorstand'}:\n` +
        renderBimComplianceDiff(result.complianceChanges ?? [])
      )
    case 'profile':
      return renderProfileSuggestions(result.profileSuggestions ?? [])
    case 'compare':
      return result.comparison
        ? renderComparison(result.comparison)
        : 'Der Vergleich konnte nicht durchgeführt werden.'
    case 'types': {
      const types = result.types ?? []
      if (types.length === 0) return 'Das Modell enthält keine Bauteile.'
      return `Bauteiltypen: ${types.map((type) => `${type.ifcType} (${type.elements})`).join(', ')}.`
    }
    case 'elements': {
      const total = result.total ?? 0
      const shown = result.elements?.length ?? 0
      if (total === 0) return 'Kein Bauteil erfüllt die Abfrage.'
      const listed = shown < total ? `, davon ${shown} aufgelistet` : ''
      return result.totalIsLowerBound
        ? `Mindestens ${total} Bauteile erfüllen die Abfrage${listed}. Die Gesamtzahl wurde nicht zu Ende gezählt.`
        : total === 1
          ? `1 Bauteil erfüllt die Abfrage${listed}.`
          : `${total} Bauteile erfüllen die Abfrage${listed}.`
    }
    case 'element':
      return result.element
        ? `Bauteil ${result.element.ifcType} „${result.element.name ?? result.element.globalId}“.`
        : 'Kein Bauteil mit dieser GlobalId im Modell.'
    case 'properties': {
      const properties = result.properties ?? []
      if (properties.length === 0) return 'Das Modell enthält keine Property Sets.'
      const scan = result.propertyScan
      return scan && !scan.complete
        ? `${properties.length} Merkmale, ermittelt aus einer Stichprobe von ${scan.scanned} der ` +
            `${scan.total} Bauteile (je Bauteiltyp). Die Merkmals- und Wertnamen sind vollständig ` +
            `belastbar, die Anzahlen beziehen sich NUR auf die Stichprobe.`
        : `${properties.length} Merkmale im Modell.`
    }
    case 'aggregate': {
      const groups = result.groups ?? []
      if (groups.length === 0) return 'Kein Bauteil erfüllt die Abfrage.'
      const unit = quantityUnit(request, result.units)
      const over = (group: { elements: number; measured: number }): string =>
        group.measured === group.elements
          ? `${group.elements} Bauteile`
          : `${group.measured} von ${group.elements} Bauteilen ` +
            `(${group.elements - group.measured} ohne Wert)`

      if (!request.groupBy) {
        const only = groups[0]
        return request.metric === 'count'
          ? `${only.elements} Bauteil${only.elements === 1 ? '' : 'e'}.`
          : `${request.metric}(${request.quantity}) = ${only.metric === null ? '—' : formatNumber(only.metric)}${unit} über ${over(only)}.`
      }
      const rendered = groups
        .map((group) => {
          const label = group.key ?? '(ohne Angabe)'
          if (request.metric === 'count') return `${label}: ${group.elements}`
          const measured =
            group.measured === group.elements
              ? `${group.elements}`
              : `${group.measured}/${group.elements}`
          return `${label}: ${group.metric === null ? '—' : formatNumber(group.metric)}${unit} (${measured})`
        })
        .join(', ')
      return `${rendered}.`
    }
  }
}

export async function runBimQuery(
  request: BimQuery,
  context: { modelId: string; organizationId: string }
): Promise<BimQueryResult> {
  const model = await findBimModelById(context.modelId, context.organizationId, internalRead('reloaded'))
  if (!model) throw new BimModelNotReadyError('failed', 'Model not found')
  if (model.status !== 'ready') {
    throw new BimModelNotReadyError(
      model.status,
      model.status === 'failed'
        ? `Model extraction failed: ${model.errorMessage ?? 'unknown error'}`
        : 'Model is still being extracted'
    )
  }

  const modelBase: Omit<BimQueryResult, 'summary'> = {
    op: request.op,
    model: {
      id: model.id,
      filename: model.filename,
      schema: model.schemaVersion,
      elementCount: model.elementCount,
    },
  }

  const health = model.summary?.health ?? null
  const CAVEATED_OPS = new Set(['overview', 'types', 'elements', 'aggregate'])
  const healthNote = health && CAVEATED_OPS.has(request.op) ? healthCaveat(health) : null

  const ROW_READING_OPS = new Set([
    'types',
    'elements',
    'aggregate',
    'schedule',
    'takeoff',
    'compare',
    'compliance',
    'compliance-diff',
    'health',
    'profile',
    'properties',
  ])
  const truncatedAt = model.summary?.truncatedAt ?? null
  const capNote =
    truncatedAt !== null && ROW_READING_OPS.has(request.op)
      ? `Achtung: von diesem Modell sind nur ${truncatedAt} Bauteile gespeichert — die Datei ist größer. ` +
        `Jede Zahl aus dieser Abfrage bezieht sich auf den gespeicherten Teil, nicht auf das ganze Gebäude.`
      : null

  const caveat = [capNote, healthNote].filter(Boolean).join(' ') || null

  const finish = (partial: Omit<BimQueryResult, 'summary'>): BimQueryResult => ({
    ...partial,
    caveat,
    summary: renderSummary(request, partial),
  })

  switch (request.op) {
    case 'overview':
      return finish({ ...modelBase, overview: model.summary ?? undefined })

    case 'health':
      return finish({ ...modelBase, health: health ?? undefined })

    case 'types':
      return finish({
        ...modelBase,
        types: await countBimElementsByType(context.modelId, context.organizationId),
      })

    case 'elements': {
      const { rows, total, totalIsLowerBound } = await listBimElements({
        modelId: context.modelId,
        organizationId: context.organizationId,
        plan: buildBimElementPlan(request.filter, {
          searchKeysIndexed: model.searchKeysIndexed,
        }),
        elementCount: model.elementCount,
        limit: request.limit,
        offset: request.offset,
      })
      return finish({
        ...modelBase,
        elements: rows,
        total,
        totalIsLowerBound,
        truncated: totalIsLowerBound || request.offset + rows.length < total,
      })
    }

    case 'element':
      return finish({
        ...modelBase,
        element: await findBimElement(context.modelId, context.organizationId, request.globalId),
      })

    case 'properties': {
      const catalog = await listBimPropertyCatalog({
        modelId: context.modelId,
        organizationId: context.organizationId,
        ifcType: request.ifcType,
        maxValues: request.maxValues,
      })
      return finish({
        ...modelBase,
        properties: catalog.entries,
        propertyScan: {
          scanned: catalog.scanned,
          total: catalog.total,
          complete: catalog.complete,
        },
      })
    }

    case 'schedule': {
      if (!model.summary) throw new BimModelNotReadyError('failed', 'Model has no summary')
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId
      )
      return finish({ ...modelBase, truncated, schedule: buildRoomSchedule(model.summary, elements) })
    }

    case 'compliance': {
      return finish({
        ...modelBase,
        ...(await complianceRun(model, context.organizationId, {
          buildingClass: request.buildingClass ?? null,
          mainUse: request.mainUse ?? null,
        })),
      })
    }

    case 'takeoff': {
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId,
        buildBimPredicate(request.filter, { searchKeysIndexed: model.searchKeysIndexed })
      )
      return finish({
        ...modelBase,
        truncated,
        takeoff: buildQuantityTakeoff(elements, {
          quantity: request.quantity,
          byMaterial: request.byMaterial,
        }),
      })
    }

    case 'compliance-diff': {
      if (!request.baseModelId) {
        throw new BimModelNotReadyError('failed', 'compliance-diff requires a base model')
      }
      const base = await findBimModelById(request.baseModelId, context.organizationId, internalRead('reloaded'))
      if (!base || base.status !== 'ready') {
        throw new BimModelNotReadyError(base?.status ?? 'failed', 'Base model is not ready')
      }
      const facts = {
        buildingClass: request.buildingClass ?? null,
        mainUse: request.mainUse ?? null,
      }
      const siteContext = await contextOfModel(model, context.organizationId)
      const [before, after] = await Promise.all([
        complianceRun(base, context.organizationId, facts, siteContext),
        complianceRun(model, context.organizationId, facts, siteContext),
      ])
      return finish({
        ...modelBase,
        compliance: after.compliance,
        complianceSummary: after.complianceSummary,
        complianceShoppingList: after.complianceShoppingList,
        complianceChanges: diffBimCompliance(before.compliance, after.compliance),
        comparedWith: base.filename,
        truncated: before.truncated || after.truncated,
      })
    }

    case 'profile': {
      if (!model.summary) throw new BimModelNotReadyError('failed', 'Model has no summary')
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId
      )
      return finish({
        ...modelBase,
        truncated,
        profileSuggestions: deriveProfileSuggestions({
          summary: model.summary,
          spaceNames: elements
            .filter((element) => element.ifcType === 'IfcSpace')
            .map((element) => element.name ?? '')
            .filter(Boolean),
        }),
      })
    }

    case 'compare': {
      if (!request.baseModelId) {
        throw new BimModelNotReadyError('failed', 'No model to compare against was resolved')
      }
      const baseModel = await findBimModelById(request.baseModelId, context.organizationId, internalRead('reloaded'))
      if (!baseModel || baseModel.status !== 'ready') {
        throw new BimModelNotReadyError(
          baseModel?.status ?? 'failed',
          'The model to compare against is not ready'
        )
      }
      const [baseElements, revisionElements] = await Promise.all([
        loadBimElementsForComparison(baseModel.id, context.organizationId, request.limit),
        loadBimElementsForComparison(context.modelId, context.organizationId, request.limit),
      ])
      return finish({
        ...modelBase,
        comparison: compareModels({
          base: baseElements.elements,
          revision: revisionElements.elements,
          truncated: baseElements.truncated || revisionElements.truncated,
        }),
      })
    }

    case 'aggregate': {
      const groups = await aggregateBimElements({
        modelId: context.modelId,
        organizationId: context.organizationId,
        where: buildBimPredicate(request.filter, { searchKeysIndexed: model.searchKeysIndexed }),
        groupExpression: groupExpression(request.groupBy, request.groupProperty),
        metricExpression: metricExpression(request),
        metricValueExpression: metricValueExpression(request),
        limit: request.limit,
      })
      return finish({
        ...modelBase,
        groups,
        units: model.summary?.units,
        truncated: groups.some((group) => group.truncated),
      })
    }
  }
}

export type {
  BimComplianceChange,
  BimComplianceSummary,
  BimRuleResult,
  BimElementListRow,
  BimGroupedCount,
  BimPropertyCatalogEntry,
  BimComparison,
  BimRoomSchedule,
  BimQuantityRow,
  BimProfileSuggestion,
}
