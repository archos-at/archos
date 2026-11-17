import 'server-only'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { bimElements, bimModels, type BimElementRow } from '@/lib/db/schema/bim'
import { BIM_ELEMENTS_PAGE_LIMIT } from './types'

export const BIM_ELEMENT_PAGE_LIMIT = BIM_ELEMENTS_PAGE_LIMIT

export interface BimElementListRow {
  globalId: string
  expressId: number
  ifcType: string
  name: string | null
  predefinedType: string | null
  tag: string | null
  typeName: string | null
  storeyName: string | null
  materials: string[]
}

const ELEMENT_LIST_COLUMNS = {
  globalId: bimElements.globalId,
  expressId: bimElements.expressId,
  ifcType: bimElements.ifcType,
  name: bimElements.name,
  predefinedType: bimElements.predefinedType,
  tag: bimElements.tag,
  typeName: bimElements.typeName,
  storeyName: bimElements.storeyName,
  materials: bimElements.materials,
} as const

export function elementScope(modelId: string, organizationId: string) {
  return and(
    eq(bimElements.modelId, modelId),
    sql`EXISTS (SELECT 1 FROM ${bimModels} m WHERE m.id = ${bimElements.modelId} AND m.organization_id = ${organizationId})`
  )
}

export const COUNT_CEILING = 10_000

export interface BimElementQueryPlan {
  assisted: SQL | undefined
  unassisted: SQL | undefined
  candidates: SQL | undefined | null
}

export const PLAN_ROW_BUDGET = 2_000

export function shouldWalkOrdered(input: {
  matched: number
  candidates: number | null
  rowsNeeded: number
  elementCount: number
}): boolean {
  if (input.candidates === null || input.candidates <= PLAN_ROW_BUDGET) return false
  const walkRows =
    input.matched > 0
      ? Math.ceil((input.rowsNeeded * input.elementCount) / input.matched)
      : input.elementCount
  return walkRows <= PLAN_ROW_BUDGET
}

export interface BimElementPage {
  rows: BimElementListRow[]
  total: number
  totalIsLowerBound: boolean
  walked: boolean
}

export async function listBimElements(input: {
  modelId: string
  organizationId: string
  plan: BimElementQueryPlan
  elementCount: number
  limit: number
  offset: number
}): Promise<BimElementPage> {
  const db = getDb()
  const limit = Math.min(Math.max(1, Math.trunc(input.limit)), BIM_ELEMENT_PAGE_LIMIT)
  const offset = Math.max(0, Math.trunc(input.offset))
  const scope = elementScope(input.modelId, input.organizationId)
  const assisted = and(scope, input.plan.assisted)
  const candidates = input.plan.candidates ? and(scope, input.plan.candidates) : null

  return withTenant({ organizationId: input.organizationId }, async () => {
    const counts = await db.execute<{ matches: number; candidates: number | null }>(sql`
      SELECT
        (
          SELECT count(*)::int
          FROM (SELECT 1 FROM ${bimElements} WHERE ${assisted} LIMIT ${COUNT_CEILING + 1}) m
        ) AS matches,
        ${
          candidates
            ? sql`(
                SELECT count(*)::int
                FROM (SELECT 1 FROM ${bimElements} WHERE ${candidates} LIMIT ${PLAN_ROW_BUDGET + 1}) c
              )`
            : sql`NULL::int`
        } AS candidates
    `)
    const row = Array.from(counts)[0]
    const matched = Number(row?.matches ?? 0)
    const candidateRows = row?.candidates === null || row?.candidates === undefined
      ? null
      : Number(row.candidates)

    const walked = shouldWalkOrdered({
      matched,
      candidates: candidateRows,
      rowsNeeded: limit + offset,
      elementCount: input.elementCount,
    })

    const rows = await db
      .select(ELEMENT_LIST_COLUMNS)
      .from(bimElements)
      .where(walked ? and(scope, input.plan.unassisted) : assisted)
      .orderBy(asc(bimElements.ifcType), asc(bimElements.expressId))
      .limit(limit)
      .offset(offset)

    const totalIsLowerBound = matched > COUNT_CEILING
    return {
      rows,
      total: totalIsLowerBound ? COUNT_CEILING : matched,
      totalIsLowerBound,
      walked,
    }
  })
}

export async function findBimElement(
  modelId: string,
  organizationId: string,
  globalId: string
): Promise<BimElementRow | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(bimElements)
      .where(and(elementScope(modelId, organizationId), eq(bimElements.globalId, globalId)))
      .limit(1)
  )
  return rows[0] ?? null
}

export async function findBimElementsByGlobalIds(
  modelId: string,
  organizationId: string,
  globalIds: readonly string[]
): Promise<BimElementListRow[]> {
  if (globalIds.length === 0) return []
  const db = getDb()
  const bounded = globalIds.slice(0, BIM_ELEMENT_PAGE_LIMIT)
  return withTenant({ organizationId }, () =>
    db
      .select(ELEMENT_LIST_COLUMNS)
      .from(bimElements)
      .where(and(elementScope(modelId, organizationId), inArray(bimElements.globalId, bounded)))
      .limit(BIM_ELEMENT_PAGE_LIMIT)
  )
}
