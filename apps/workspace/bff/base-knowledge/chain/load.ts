/**
 * The knowledge graph an office reads for a site (ADR-0168): the released
 * platform records it may read, and the office's own relations with the works
 * and editions they name. Every query runs as the office (`withTenant`) and
 * names the owner condition itself, so the layered RLS (0205, 0209) is the
 * backstop, not the filter:
 *
 * - a platform row has a head and belongs to a country the office is entitled
 *   to, or a released relation reaches it from one (design §3.5);
 * - an office row is this office's own; another office's never is.
 *
 * Bounded: the territories on the leaf's chain, at most `MAX_ROWS` of each
 * other type. A graph that hit a bound says so (`truncated`), and the turn
 * then uses none of it rather than a partial one.
 */

import { sourceRefsOf } from './source-refs'
import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { sqlTextArray } from '@/lib/db/sql-list'
import { withTenant } from '@/lib/db/tenant-context'
import type { DatedParent, RelationAnchor } from '@/lib/db/schema/knowledge-platform'
import type { BindingMode, ConnectingFactor, CoverageLevel, KnowledgeWorkKind, RelationEndType, RelationType, TerritoryKind } from '../wire/vocab'
import { recordReadable } from '../store/visibility'
import type { GraphEdition, GraphOwner, GraphRelation, GraphTerritory, GraphWork, KnowledgeGraph } from './graph'

/** Most rows of one type a graph reads. */
export const MAX_ROWS = 2000

/** Deepest territory chain followed. */
const MAX_TERRITORY_DEPTH = 16

export interface LoadedGraph {
  graph: KnowledgeGraph
  truncated: boolean
}

interface TerritoryRow extends Record<string, unknown> {
  id: string
  kind: TerritoryKind
  name: string
  parent_ids: string[]
  dated_parents: DatedParent[]
  valid_from: string | null
  valid_to: string | null
  coverage_level: CoverageLevel | null
  municipal_law: boolean | null
}

interface RelationRow extends Record<string, unknown> {
  id: string
  organization_id: string | null
  relation_type: RelationType
  mode: BindingMode | null
  from_id: string
  from_type: RelationEndType
  to_id: string
  to_type: RelationEndType
  anchors: RelationAnchor[]
  provision: string | null
  valid_from: string | null
  valid_to: string | null
}

interface WorkRow extends Record<string, unknown> {
  id: string
  organization_id: string | null
  kind: KnowledgeWorkKind
  title: string
  designation: string | null
  identifiers: Record<string, unknown> | null
  territory_ids: string[]
  addressee_territory_ids: string[] | null
  connects_by: ConnectingFactor[] | null
  history_available_from: string | null
}

interface EditionRow extends Record<string, unknown> {
  id: string
  organization_id: string | null
  work_id: string
  label: string
  issued_on: string | null
  in_force_from: string | null
  in_force_to: string | null
  corpus_files: string[] | null
  checked_at: string | Date | null
  check_result: string | null
}

const dateText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value).slice(0, 10))

/** A platform row the office may read, or the office's own row: the owner condition every query below names. */
const readable = (organizationId: string) => recordReadable('r', organizationId)

async function territoriesOn(organizationId: string, leafId: string): Promise<TerritoryRow[]> {
  const iso = /^([A-Z]{2})-/.exec(leafId)?.[1] ?? leafId
  return getDb().execute<TerritoryRow>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT unnest(ARRAY[${leafId}::text, ${iso}::text]), 0
      UNION
      SELECT p.id, c.depth + 1
      FROM chain c
      JOIN knowledge_records r ON r.id = c.id AND r.organization_id IS NULL AND r.type = 'territory' AND r.head_revision_id IS NOT NULL
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      CROSS JOIN LATERAL (
        SELECT unnest(t.parent_ids) AS id
        UNION SELECT d ->> 'id' FROM jsonb_array_elements(t.dated_parents) AS d
      ) p
      WHERE c.depth < ${MAX_TERRITORY_DEPTH}
    )
    SELECT r.id, t.kind, t.name, t.parent_ids, t.dated_parents, t.valid_from, t.valid_to, t.coverage_level, t.municipal_law
    FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
    WHERE r.organization_id IS NULL AND r.type = 'territory' AND r.id IN (SELECT id FROM chain)
      AND ${readable(organizationId)}
    LIMIT ${MAX_ROWS}`)
}

async function relationsFor(organizationId: string): Promise<RelationRow[]> {
  return getDb().execute<RelationRow>(sql`
    SELECT r.id, r.organization_id, x.relation_type, x.mode, x.from_id, x.from_type, x.to_id, x.to_type, x.anchors,
      x.provision, x.valid_from, x.valid_to
    FROM knowledge_records r JOIN knowledge_relation_revisions x ON x.revision_id = r.head_revision_id
    WHERE r.type = 'relation' AND ${readable(organizationId)}
    ORDER BY r.id
    LIMIT ${MAX_ROWS}`)
}

/**
 * Works on the chain, and the works a relation names (by itself or by one of
 * its editions). The office's own works only when its relation names them:
 * its copies are its base-knowledge block's (`office/turn-block.ts`), not law.
 */
async function worksFor(organizationId: string, chain: readonly string[], named: readonly string[]): Promise<WorkRow[]> {
  return getDb().execute<WorkRow>(sql`
    WITH named_works AS (
      SELECT unnest(${sqlTextArray(named)}) AS id
      UNION
      SELECT e.work_id FROM knowledge_records er JOIN knowledge_edition_revisions e ON e.revision_id = er.head_revision_id
      WHERE er.id = ANY(${sqlTextArray(named)})
    )
    SELECT r.id, r.organization_id, w.kind, w.title, w.identifiers ->> 'designation' AS designation, w.identifiers, w.territory_ids,
      (SELECT array_agg(a ->> 'territoryId') FROM jsonb_array_elements(w.addressees) AS a) AS addressee_territory_ids,
      w.connects_by, w.history_available_from
    FROM knowledge_records r JOIN knowledge_work_revisions w ON w.revision_id = r.head_revision_id
    WHERE r.type = 'work' AND ${readable(organizationId)}
      AND (r.id IN (SELECT id FROM named_works)
        OR (r.organization_id IS NULL AND w.territory_ids && ${sqlTextArray(chain)}))
    ORDER BY r.id
    LIMIT ${MAX_ROWS}`)
}

async function editionsOf(organizationId: string, workIds: readonly string[]): Promise<EditionRow[]> {
  return getDb().execute<EditionRow>(sql`
    SELECT r.id, r.organization_id, e.work_id, e.label, e.issued_on, e.in_force_from, e.in_force_to,
      (SELECT array_agg(m.corpus_file ORDER BY m.corpus_file)
         FROM knowledge_records mr JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
         WHERE mr.organization_id IS NULL AND m.edition_id = r.id AND m.corpus_file IS NOT NULL) AS corpus_files,
      c.checked_at, c.result AS check_result
    FROM knowledge_records r JOIN knowledge_edition_revisions e ON e.revision_id = r.head_revision_id
    -- The platform's newest check of a platform edition: what its freshness reads (design §4.6).
    LEFT JOIN LATERAL (
      SELECT k.checked_at, k.result FROM knowledge_checks k
      WHERE k.target_id = r.id AND k.organization_id IS NULL AND r.organization_id IS NULL
      ORDER BY k.checked_at DESC LIMIT 1
    ) c ON true
    WHERE r.type = 'edition' AND ${readable(organizationId)} AND e.work_id = ANY(${sqlTextArray(workIds)})
    ORDER BY r.id
    LIMIT ${MAX_ROWS}`)
}

const ownerOf = (organizationId: string | null): GraphOwner => (organizationId === null ? 'platform' : 'office')

function toTerritory(row: TerritoryRow): GraphTerritory {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    parentIds: row.parent_ids,
    datedParents: row.dated_parents,
    validFrom: dateText(row.valid_from),
    validTo: dateText(row.valid_to),
    coverageLevel: row.coverage_level ?? null,
    municipalLaw: row.municipal_law ?? null,
  }
}

function toRelation(row: RelationRow): GraphRelation {
  return {
    id: row.id,
    owner: ownerOf(row.organization_id),
    relationType: row.relation_type,
    mode: row.mode,
    fromId: row.from_id,
    fromType: row.from_type,
    toId: row.to_id,
    toType: row.to_type,
    anchors: row.anchors,
    provision: row.provision,
    validFrom: dateText(row.valid_from),
    validTo: dateText(row.valid_to),
  }
}

function toWork(row: WorkRow): GraphWork {
  return {
    id: row.id,
    owner: ownerOf(row.organization_id),
    kind: row.kind,
    title: row.title,
    designation: row.designation,
    territoryIds: row.territory_ids,
    addresseeTerritoryIds: (row.addressee_territory_ids ?? []).filter((id): id is string => typeof id === 'string'),
    connectsBy: row.connects_by ?? ['site'],
    sourceRefs: sourceRefsOf(row.identifiers),
    historyAvailableFrom: dateText(row.history_available_from),
  }
}

function toEdition(row: EditionRow): GraphEdition {
  return {
    id: row.id,
    owner: ownerOf(row.organization_id),
    workId: row.work_id,
    label: row.label,
    issuedOn: dateText(row.issued_on),
    inForceFrom: dateText(row.in_force_from),
    inForceTo: dateText(row.in_force_to),
    corpusFiles: row.corpus_files ?? [],
    lastCheck: row.checked_at && row.check_result ? { checkedAt: new Date(row.checked_at).toISOString(), result: row.check_result } : null,
  }
}

/** The graph an office reads for a site whose leaf is `leafId`. */
export async function loadGraph(organizationId: string, leafId: string): Promise<LoadedGraph> {
  return withTenant({ organizationId }, async () => {
    const [territoryRows, relationRows] = await Promise.all([territoriesOn(organizationId, leafId), relationsFor(organizationId)])
    const chain = [...new Set([leafId, ...territoryRows.map((row) => row.id)])]
    const named = [...new Set(relationRows.flatMap((row) => [row.from_id, row.to_id]))]
    const workRows = await worksFor(organizationId, chain, named)
    const editionRows = await editionsOf(
      organizationId,
      workRows.map((row) => row.id),
    )
    const truncated = [territoryRows, relationRows, workRows, editionRows].some((rows) => rows.length >= MAX_ROWS)
    return {
      truncated,
      graph: {
        territories: new Map(territoryRows.map((row) => [row.id, toTerritory(row)])),
        works: new Map(workRows.map((row) => [row.id, toWork(row)])),
        editions: new Map(editionRows.map((row) => [row.id, toEdition(row)])),
        relations: relationRows.map(toRelation),
      },
    }
  })
}
