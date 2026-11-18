import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { bimElements } from '@/lib/db/schema/bim'
import { unnestedProperties } from './element-filter-sql'
import type { aggregateSchema, BimGroupBy } from './query-schema'

export function groupExpression(
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

export function metricValueExpression(request: z.infer<typeof aggregateSchema>): SQL | null {
  if (request.metric === 'count' || !request.quantity) return null
  return quantityExpression(request.quantity, request.quantitySet)
}

export function metricExpression(request: z.infer<typeof aggregateSchema>): SQL | null {
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
