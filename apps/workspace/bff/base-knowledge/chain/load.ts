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
 * Bounded by the walk, never by the tenant: the territories on the leaf's
 * chain, the works there and their editions, then the relations that touch
 * them and the works and editions those name, step by step (`walk`). What the
 * resolver reads is in it, whatever else the office can read.
 */

import { appliesWhenTableSchema } from '../wire/applies-when'
import { sourceRefsOf } from './source-refs'
import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { sqlTextArray } from '@/lib/db/sql-list'
import { withTenant } from '@/lib/db/tenant-context'
import type { RelationAnchor, TerritoryParent } from '@/lib/db/schema/knowledge-platform'
import { TEXT_STATUSES, type BindingMode, type ConnectingFactor, type CoverageLevel, type KnowledgeWorkKind, type RelationEndType, type RelationType, type TerritoryKind, type TextStatus } from '../wire/vocab'
import { recordReadable } from '../store/visibility'
import { walkSeeds } from './territory-chain'
import { MAX_ROUTE_DEPTH } from './resolve'
import type { GraphEdition, GraphOwner, GraphRelation, GraphTerritory, GraphWork, KnowledgeGraph } from './graph'

/**
 * Most rows one read returns: a guard against a runaway query, not a budget.
 * Nothing a site needs comes near it; a read that reaches it says so
 * (`truncated`), and the turn then uses none of the graph rather than a part.
 */
export const MAX_ROWS = 20_000

/**
 * How many relation steps the walk takes from the chain: a route's depth
 * (`MAX_ROUTE_DEPTH`), one more for what bears on the deepest binding
 * (`deviates_from`, a commentary on it), and one for that commentary's other
 * targets, which name the edition it interprets.
 */
const MAX_WALK_DEPTH = MAX_ROUTE_DEPTH + 2

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
  parents: TerritoryParent[]
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
  source_url: string | null
  text_language: string | null
  text_status: string | null
  applies_when: unknown
  checked_at: string | Date | null
  check_result: string | null
}

const isTextStatus = (value: string | null): value is TextStatus => (TEXT_STATUSES as readonly string[]).includes(value ?? '')

const dateText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value).slice(0, 10))

/** A platform row the office may read, or the office's own row: the owner condition every query below names. */
const readable = (organizationId: string) => recordReadable('r', organizationId)

async function territoriesOn(organizationId: string, leafId: string): Promise<TerritoryRow[]> {
  return getDb().execute<TerritoryRow>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT unnest(${sqlTextArray(walkSeeds(leafId))}), 0
      UNION
      SELECT p.id, c.depth + 1
      FROM chain c
      JOIN knowledge_records r ON r.id = c.id AND r.organization_id IS NULL AND r.type = 'territory' AND r.head_revision_id IS NOT NULL
      JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      CROSS JOIN LATERAL (
        SELECT d ->> 'id' AS id FROM jsonb_array_elements(t.parents) AS d
      ) p
      WHERE c.depth < ${MAX_TERRITORY_DEPTH}
    )
    SELECT r.id, t.kind, t.name, t.parents, t.valid_from, t.valid_to, t.coverage_level, t.municipal_law
    FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
    WHERE r.organization_id IS NULL AND r.type = 'territory' AND r.id IN (SELECT id FROM chain)
      AND ${readable(organizationId)}
    LIMIT ${MAX_ROWS}`)
}

/**
 * The relations that touch `frontier`: every type from it, and a `supersedes`
 * or `interprets` onto it (what ends a law on the chain, what comments on it).
 */
async function relationsTouching(organizationId: string, frontier: readonly string[]): Promise<RelationRow[]> {
  return getDb().execute<RelationRow>(sql`
    SELECT r.id, r.organization_id, x.relation_type, x.mode, x.from_id, x.from_type, x.to_id, x.to_type, x.anchors,
      x.provision, x.valid_from, x.valid_to
    FROM knowledge_records r JOIN knowledge_relation_revisions x ON x.revision_id = r.head_revision_id
    WHERE r.type = 'relation' AND ${readable(organizationId)}
      AND (x.from_id = ANY(${sqlTextArray(frontier)})
        OR (x.relation_type IN ('supersedes', 'interprets') AND x.to_id = ANY(${sqlTextArray(frontier)})))
    ORDER BY r.id
    LIMIT ${MAX_ROWS}`)
}

/**
 * Works on the chain (where they apply, or whose addressees decide there), and
 * the works a relation names (by itself or by one of its editions). The
 * office's own works only when a relation the walk reads names them: its
 * copies are its base-knowledge block's (`office/turn-block.ts`), not law.
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
        OR (r.organization_id IS NULL AND (w.territory_ids && ${sqlTextArray(chain)}
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(w.addressees) AS a WHERE a ->> 'territoryId' = ANY(${sqlTextArray(chain)})))))
    ORDER BY r.id
    LIMIT ${MAX_ROWS}`)
}

async function editionsOf(organizationId: string, workIds: readonly string[]): Promise<EditionRow[]> {
  return getDb().execute<EditionRow>(sql`
    SELECT r.id, r.organization_id, e.work_id, e.label, e.issued_on, e.in_force_from, e.in_force_to,
      (SELECT array_agg(m.corpus_file ORDER BY m.corpus_file)
         FROM knowledge_records mr JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
         WHERE mr.organization_id IS NULL AND m.edition_id = r.id AND m.corpus_file IS NOT NULL) AS corpus_files,
      -- The page a platform manifestation of it cites first: where a person opens the text (ADR-0178).
      (SELECT kr.provenance -> 'citations' -> 0 ->> 'url'
         FROM knowledge_records mr JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
         JOIN knowledge_revisions kr ON kr.revision_id = mr.head_revision_id
         WHERE mr.organization_id IS NULL AND m.edition_id = r.id AND kr.provenance -> 'citations' -> 0 ->> 'url' IS NOT NULL
         ORDER BY mr.id LIMIT 1) AS source_url,
      -- The platform manifestation that holds its text: which language, and whether it is the authentic text.
      (SELECT m.language
         FROM knowledge_records mr JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
         WHERE mr.organization_id IS NULL AND m.edition_id = r.id ORDER BY mr.id LIMIT 1) AS text_language,
      (SELECT m.text_status
         FROM knowledge_records mr JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
         WHERE mr.organization_id IS NULL AND m.edition_id = r.id ORDER BY mr.id LIMIT 1) AS text_status,
      e.applies_when,
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
    parents: row.parents,
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
    sourceUrl: row.source_url,
    text: row.text_language && isTextStatus(row.text_status) ? { language: row.text_language, status: row.text_status } : null,
    // A stored scope the wire cannot read narrows nothing: too much law shows, never too little.
    appliesWhen: row.applies_when ? (appliesWhenTableSchema.safeParse(row.applies_when).data ?? null) : null,
    lastCheck: row.checked_at && row.check_result ? { checkedAt: new Date(row.checked_at).toISOString(), result: row.check_result } : null,
  }
}

interface Walked {
  relations: Map<string, RelationRow>
  works: Map<string, WorkRow>
  editions: Map<string, EditionRow>
  truncated: boolean
}

/** Read `workRows` and their editions into `into`; the ids new to it, which the walk steps from next. */
async function admit(organizationId: string, workRows: readonly WorkRow[], into: Walked): Promise<string[]> {
  const fresh = workRows.filter((row) => !into.works.has(row.id))
  if (fresh.length === 0) return []
  const editionRows = await editionsOf(organizationId, fresh.map((row) => row.id))
  into.truncated ||= workRows.length >= MAX_ROWS || editionRows.length >= MAX_ROWS
  for (const row of fresh) into.works.set(row.id, row)
  for (const row of editionRows) into.editions.set(row.id, row)
  return [...fresh.map((row) => row.id), ...editionRows.map((row) => row.id)]
}

/**
 * From the works on the chain, the relations that touch what was read and the
 * works and editions they name, up to `MAX_WALK_DEPTH` steps: every route the
 * resolver follows, every `deviates_from` from a binding, every `supersedes`
 * or `interprets` onto one, and every work a relation names.
 */
async function walk(organizationId: string, chain: readonly string[]): Promise<Walked> {
  const walked: Walked = { relations: new Map(), works: new Map(), editions: new Map(), truncated: false }
  let frontier = await admit(organizationId, await worksFor(organizationId, chain, []), walked)
  for (let depth = 0; depth < MAX_WALK_DEPTH && frontier.length > 0; depth++) {
    const relationRows = (await relationsTouching(organizationId, frontier)).filter((row) => !walked.relations.has(row.id))
    walked.truncated ||= relationRows.length >= MAX_ROWS
    for (const row of relationRows) walked.relations.set(row.id, row)
    const named = [...new Set(relationRows.flatMap((row) => [row.from_id, row.to_id]))]
    frontier = named.length > 0 ? await admit(organizationId, await worksFor(organizationId, [], named), walked) : []
  }
  return walked
}

/** Rows by id, as one ordered read returns them: the resolver's ties break the same however the walk met them. */
const byId = <T extends { id: string }>(rows: Iterable<T>): T[] => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** The graph an office reads for a site whose leaf is `leafId`. */
export async function loadGraph(organizationId: string, leafId: string): Promise<LoadedGraph> {
  return withTenant({ organizationId }, async () => {
    const territoryRows = await territoriesOn(organizationId, leafId)
    const chain = [...new Set([leafId, ...territoryRows.map((row) => row.id)])]
    const walked = await walk(organizationId, chain)
    return {
      truncated: walked.truncated || territoryRows.length >= MAX_ROWS,
      graph: {
        territories: new Map(territoryRows.map((row) => [row.id, toTerritory(row)])),
        works: new Map(byId(walked.works.values()).map((row) => [row.id, toWork(row)])),
        editions: new Map(byId(walked.editions.values()).map((row) => [row.id, toEdition(row)])),
        relations: byId(walked.relations.values()).map(toRelation),
      },
    }
  })
}
