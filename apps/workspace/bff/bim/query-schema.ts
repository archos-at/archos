import 'server-only'
import { z } from 'zod'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { BIM_ELEMENT_OFFSET_LIMIT, BIM_ELEMENTS_PAGE_LIMIT } from './types'

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

export const aggregateSchema = z.object({
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
