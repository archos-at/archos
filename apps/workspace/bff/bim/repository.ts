import 'server-only'
import { and, asc, count, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import { bimCheckConfirmations, bimElements, bimModels, type BimElementRow, type BimModelRow } from '@/lib/db/schema/bim'
import { documents } from '@/lib/db/schema/documents'
import { ifcTypeVariants } from './rules'
import type { StoredRuleInputs } from './rule-inputs'
import { BIM_ELEMENTS_PAGE_LIMIT } from './types'
import type { BimElement, BimModelStatus, BimModelSummary } from './types'

export const BIM_ELEMENT_PAGE_LIMIT = BIM_ELEMENTS_PAGE_LIMIT

export interface BimModelHeader {
  id: string
  documentId: string
  projectId: string | null
  filename: string
  displayName: string | null
  status: BimModelStatus
  schemaVersion: string | null
  elementCount: number
  errorMessage: string | null
  summary: BimModelSummary | null
  searchKeysIndexed: boolean
  updatedAt: Date
}

const MODEL_COLUMNS = {
  id: bimModels.id,
  documentId: bimModels.documentId,
  projectId: bimModels.projectId,
  filename: documents.filename,
  displayName: documents.displayName,
  status: bimModels.status,
  schemaVersion: bimModels.schemaVersion,
  elementCount: bimModels.elementCount,
  errorMessage: bimModels.errorMessage,
  summary: bimModels.summary,
  searchKeysIndexed: bimModels.searchKeysIndexed,
  updatedAt: bimModels.updatedAt,
} as const

export async function findBimModelById(
  modelId: string,
  organizationId: string,
  reader: DocumentReader
): Promise<BimModelHeader | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(and(eq(bimModels.id, modelId), eq(bimModels.organizationId, organizationId), documentVisibleTo(reader)))
      .limit(1)
  )
  return rows[0] ?? null
}

export async function findBimModelByDocument(
  documentId: string,
  organizationId: string,
  reader: DocumentReader
): Promise<BimModelHeader | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(eq(bimModels.documentId, documentId), eq(bimModels.organizationId, organizationId), documentVisibleTo(reader))
      )
      .limit(1)
  )
  return rows[0] ?? null
}

export async function listBimModels(
  organizationId: string,
  options: {
    projectId?: string | null
    includeOfficeShelf?: boolean
    limit?: number
    hiddenFolderIds?: readonly string[]
    reader: DocumentReader
  }
): Promise<BimModelHeader[]> {
  const db = getDb()
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), 200)
  const officeShelfScope = eq(documents.scope, 'office_shelf')
  const scope =
    options.projectId === undefined
      ? undefined
      : options.includeOfficeShelf
        ? sql`(${bimModels.projectId} = ${options.projectId} OR ${officeShelfScope})`
        : options.projectId === null
          ? officeShelfScope
          : eq(bimModels.projectId, options.projectId)
  const hidden = options.hiddenFolderIds ?? []
  const outsideHiddenFolders =
    hidden.length > 0 ? or(isNull(documents.folderId), notInArray(documents.folderId, [...hidden])) : undefined

  return withTenant({ organizationId }, () =>
    db
      .select(MODEL_COLUMNS)
      .from(bimModels)
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(
          eq(bimModels.organizationId, organizationId),
          scope,
          outsideHiddenFolders,
          documentVisibleTo(options.reader)
        )
      )
      .orderBy(desc(bimModels.updatedAt))
      .limit(limit)
  )
}

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

function elementScope(modelId: string, organizationId: string) {
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

export interface BimPropertyCatalogEntry {
  set: string
  name: string
  source: 'property' | 'quantity'
  elements: number
  values: Array<{ value: string; elements: number }>
}

export interface BimPropertyCatalog {
  entries: BimPropertyCatalogEntry[]
  scanned: number
  total: number
  complete: boolean
}

export const PROPERTY_CATALOG_SCAN_LIMIT = 5_000

const PER_TYPE_MIN = 25
const PER_TYPE_MAX = 200

export async function listBimPropertyCatalog(input: {
  modelId: string
  organizationId: string
  ifcType?: string
  maxValues: number
}): Promise<BimPropertyCatalog> {
  const db = getDb()
  const maxValues = Math.min(Math.max(1, Math.trunc(input.maxValues)), 50)
  const typeFilter = input.ifcType
    ? sql`AND lower(e.ifc_type) IN (${sql.join(
        ifcTypeVariants(input.ifcType).map((variant) => sql`${variant}`),
        sql`, `
      )})`
    : sql``
  const tenantScope = sql`
    EXISTS (
      SELECT 1 FROM bim_models m
      WHERE m.id = e.model_id AND m.organization_id = ${input.organizationId}
    )
  `

  return withTenant({ organizationId: input.organizationId }, async () => {
    const typeRows = await db.execute<{ ifc_type: string; elements: string }>(sql`
      SELECT e.ifc_type, count(*)::text AS elements
      FROM bim_elements e
      WHERE e.model_id = ${input.modelId} AND ${tenantScope} ${typeFilter}
      GROUP BY e.ifc_type
    `)
    const types = Array.from(typeRows).map((row) => ({
      ifcType: row.ifc_type,
      elements: Number(row.elements),
    }))
    const total = types.reduce((sum, type) => sum + type.elements, 0)
    if (total === 0) {
      return { entries: [], scanned: 0, total: 0, complete: !input.ifcType }
    }

    const perType =
      total <= PROPERTY_CATALOG_SCAN_LIMIT
        ? null
        : Math.min(
            PER_TYPE_MAX,
            Math.max(PER_TYPE_MIN, Math.floor(PROPERTY_CATALOG_SCAN_LIMIT / types.length))
          )
    const scanned =
      perType === null
        ? total
        : types.reduce((sum, type) => sum + Math.min(type.elements, perType), 0)

    const scoped =
      perType === null
        ? sql`
            SELECT e.properties, e.quantities
            FROM bim_elements e
            WHERE e.model_id = ${input.modelId} AND ${tenantScope} ${typeFilter}
          `
        : sql`
            SELECT slice.properties, slice.quantities
            FROM (VALUES ${sql.join(
              types.map((type) => sql`(${type.ifcType}::text)`),
              sql`, `
            )}) AS t(ifc_type)
            CROSS JOIN LATERAL (
              SELECT e.properties, e.quantities
              FROM bim_elements e
              WHERE e.model_id = ${input.modelId}
                AND e.ifc_type = t.ifc_type
                AND ${tenantScope}
              LIMIT ${perType}
            ) slice
          `

    const rows = await db.execute<{
      set_name: string
      prop_name: string
      source: 'property' | 'quantity'
      element_total: string
      values: Array<{ value: string; elements: number }> | null
    }>(sql`
      WITH scoped AS (${scoped}),
      pairs AS (
        SELECT s.set_name, p.prop_name, 'property'::text AS source, p.prop_value #>> '{}' AS value
        FROM scoped e, jsonb_each(e.properties) AS s(set_name, set_value),
             jsonb_each(s.set_value) AS p(prop_name, prop_value)
        UNION ALL
        SELECT s.set_name, p.prop_name, 'quantity'::text AS source, p.prop_value #>> '{}' AS value
        FROM scoped e, jsonb_each(e.quantities) AS s(set_name, set_value),
             jsonb_each(s.set_value) AS p(prop_name, prop_value)
      ),
      counted AS (
        SELECT set_name, prop_name, source, value, count(*) AS occurrences
        FROM pairs
        GROUP BY set_name, prop_name, source, value
      ),
      ranked AS (
        SELECT *, row_number() OVER (
          PARTITION BY set_name, prop_name, source ORDER BY occurrences DESC, value ASC
        ) AS rank
        FROM counted
      )
      SELECT set_name, prop_name, source,
             sum(occurrences)::text AS element_total,
             jsonb_agg(
               jsonb_build_object('value', value, 'elements', occurrences)
               ORDER BY occurrences DESC, value ASC
             ) FILTER (WHERE rank <= ${maxValues}) AS values
      FROM ranked
      GROUP BY set_name, prop_name, source
      ORDER BY source ASC, set_name ASC, prop_name ASC
    `)

    return {
      entries: Array.from(rows).map((row) => ({
        set: row.set_name,
        name: row.prop_name,
        source: row.source,
        elements: Number(row.element_total),
        values: (row.values ?? []).map((entry) => ({
          value: entry.value,
          elements: Number(entry.elements),
        })),
      })),
      scanned,
      total,
      complete: perType === null,
    }
  })
}

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

export async function loadBimRuleInputs(
  modelId: string,
  organizationId: string
): Promise<unknown | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ ruleInputs: bimModels.ruleInputs })
      .from(bimModels)
      .where(and(eq(bimModels.id, modelId), eq(bimModels.organizationId, organizationId)))
      .limit(1)
  )
  return rows[0]?.ruleInputs ?? null
}

export async function saveBimRuleInputs(
  modelId: string,
  organizationId: string,
  ruleInputs: StoredRuleInputs,
  expected: unknown
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(bimModels)
      .set({ ruleInputs })
      .where(
        and(
          eq(bimModels.id, modelId),
          eq(bimModels.organizationId, organizationId),
          sql`${bimModels.ruleInputs} IS NOT DISTINCT FROM ${
            expected === null || expected === undefined
              ? sql`NULL::jsonb`
              : sql`${JSON.stringify(expected)}::jsonb`
          }`
        )
      )
  )
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

export type { BimModelRow, BimElementRow }

export interface BimStoredConfirmation {
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
  confirmedAt: Date
}

export async function listBimCheckConfirmations(
  organizationId: string,
  projectId: string,
  reader: DocumentReader
): Promise<BimStoredConfirmation[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        ruleId: bimCheckConfirmations.ruleId,
        modelId: bimCheckConfirmations.modelId,
        confirmedBy: bimCheckConfirmations.confirmedBy,
        note: bimCheckConfirmations.note,
        confirmedAt: bimCheckConfirmations.updatedAt,
      })
      .from(bimCheckConfirmations)
      .innerJoin(
        bimModels,
        and(eq(bimModels.id, bimCheckConfirmations.modelId), eq(bimModels.organizationId, organizationId))
      )
      .innerJoin(documents, eq(documents.id, bimModels.documentId))
      .where(
        and(
          eq(bimCheckConfirmations.organizationId, organizationId),
          eq(bimCheckConfirmations.projectId, projectId),
          documentVisibleTo(reader)
        )
      )
  )
  return rows
}

export async function upsertBimCheckConfirmation(input: {
  organizationId: string
  projectId: string
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
}): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId: input.organizationId }, () =>
    db
      .insert(bimCheckConfirmations)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        ruleId: input.ruleId,
        modelId: input.modelId,
        confirmedBy: input.confirmedBy,
        note: input.note,
      })
      .onConflictDoUpdate({
        target: [
          bimCheckConfirmations.organizationId,
          bimCheckConfirmations.projectId,
          bimCheckConfirmations.ruleId,
          bimCheckConfirmations.modelId,
        ],
        set: {
          confirmedBy: input.confirmedBy,
          note: input.note,
          updatedAt: new Date(),
        },
      })
  )
}

export async function deleteBimCheckConfirmation(input: {
  organizationId: string
  projectId: string
  ruleId: string
  modelIds: readonly string[]
}): Promise<void> {
  if (input.modelIds.length === 0) return
  const db = getDb()
  await withTenant({ organizationId: input.organizationId }, () =>
    db
      .delete(bimCheckConfirmations)
      .where(
        and(
          eq(bimCheckConfirmations.organizationId, input.organizationId),
          eq(bimCheckConfirmations.projectId, input.projectId),
          eq(bimCheckConfirmations.ruleId, input.ruleId),
          inArray(bimCheckConfirmations.modelId, [...input.modelIds])
        )
      )
  )
}
