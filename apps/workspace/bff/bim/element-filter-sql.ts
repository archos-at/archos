import 'server-only'
import { and, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { likeContains } from '@/lib/text/like-pattern'
import { bimElements } from '@/lib/db/schema/bim'
import { ifcTypeVariants } from './rules'
import type { BimElementQueryPlan } from './repository'
import type { BimFilter, BimPropertyFilter } from './query-schema'

export function unnestedProperties(source: 'property' | 'quantity'): SQL {
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
