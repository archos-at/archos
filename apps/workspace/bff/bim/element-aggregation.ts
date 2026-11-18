import 'server-only'
import { and, asc, count, desc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimElements } from '@/lib/db/schema/bim'
import { BIM_ELEMENT_PAGE_LIMIT, elementScope } from './element-queries'

export interface BimGroupedCount {
  key: string | null
  elements: number
  metric: number | null
  measured: number
  truncated: boolean
}

export async function aggregateBimElements(input: {
  modelId: string
  organizationId: string
  where?: ReturnType<typeof and>
  groupExpression: ReturnType<typeof sql> | null
  metricExpression: ReturnType<typeof sql> | null
  metricValueExpression: ReturnType<typeof sql> | null
  limit: number
}): Promise<BimGroupedCount[]> {
  const db = getDb()
  const predicate = and(elementScope(input.modelId, input.organizationId), input.where)
  const limit = Math.min(Math.max(1, Math.trunc(input.limit)), BIM_ELEMENT_PAGE_LIMIT)
  const groupKey = input.groupExpression ?? sql<string | null>`NULL::text`
  const metric = input.metricExpression ?? sql<number | null>`NULL::numeric`

  const rows = await withTenant({ organizationId: input.organizationId }, () => {
    const query = db
      .select({
        key: sql<string | null>`${groupKey}`.as('group_key'),
        elements: count(),
        metric: sql<string | null>`${metric}`.as('metric'),
        measured: input.metricValueExpression
          ? sql<number>`count(${input.metricValueExpression})`.as('measured')
          : count(),
      })
      .from(bimElements)
      .where(predicate)
      .orderBy(desc(count()), asc(sql`1`))
      .limit(limit + 1)
    return input.groupExpression ? query.groupBy(sql`1`) : query
  })

  return rows.slice(0, limit).map((row) => ({
    key: row.key ?? null,
    elements: Number(row.elements),
    metric: row.metric === null || row.metric === undefined ? null : Number(row.metric),
    measured: Number(row.measured ?? row.elements),
    truncated: rows.length > limit,
  }))
}

export async function countBimElementsByType(
  modelId: string,
  organizationId: string
): Promise<Array<{ ifcType: string; elements: number }>> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ ifcType: bimElements.ifcType, elements: count() })
      .from(bimElements)
      .where(elementScope(modelId, organizationId))
      .groupBy(bimElements.ifcType)
      .orderBy(desc(count()), asc(bimElements.ifcType))
  )
  return rows.map((row) => ({ ifcType: row.ifcType, elements: Number(row.elements) }))
}
