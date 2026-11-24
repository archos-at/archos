import 'server-only'
import { and, asc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimElements, type BimElementRow } from '@/lib/db/schema/bim'
import type { BimElement } from './types'
import { elementScope } from './element-queries'

export async function loadBimElementsForComparison(
  modelId: string,
  organizationId: string,
  limit: number
): Promise<{ elements: BimElement[]; truncated: boolean }> {
  const db = getDb()
  const bounded = Math.max(1, Math.trunc(limit))
  const rows = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(bimElements)
      .where(elementScope(modelId, organizationId))
      .orderBy(asc(bimElements.globalId))
      .limit(bounded + 1)
  )
  return { elements: rows.slice(0, bounded).map(toBimElement), truncated: rows.length > bounded }
}

function toBimElement(row: BimElementRow): BimElement {
  return {
    globalId: row.globalId,
    expressId: row.expressId,
    ifcType: row.ifcType,
    name: row.name,
    description: null,
    predefinedType: row.predefinedType,
    objectType: row.objectType,
    tag: row.tag,
    typeName: row.typeName,
    containerKind: (row.containerKind as BimElement['containerKind']) ?? null,
    containerGlobalId: null,
    containerName: row.containerName,
    storeyGlobalId: row.storeyGlobalId,
    storeyName: row.storeyName,
    materials: row.materials,
    classifications: row.classifications,
    properties: row.properties,
    quantities: row.quantities,
  }
}

export async function loadBimElementsForSchedule(
  modelId: string,
  organizationId: string,
  where?: ReturnType<typeof and>,
  limit = 50_000
): Promise<{ elements: BimElement[]; truncated: boolean }> {
  const db = getDb()
  const bounded = Math.max(1, Math.trunc(limit))
  const rows = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(bimElements)
      .where(and(elementScope(modelId, organizationId), where))
      .orderBy(asc(bimElements.expressId))
      .limit(bounded + 1)
  )
  return {
    elements: rows.slice(0, bounded).map(toBimElement),
    truncated: rows.length > bounded,
  }
}
