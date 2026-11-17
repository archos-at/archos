import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { ifcTypeVariants } from './rules'

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
