import 'server-only'
import { and, desc, ne, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { CITATION_BASELINE_KIND, CITATION_PRECISION_KIND, citationEvents, type CitationEvent, type CitationEventKind, type NewCitationEvent } from '@/lib/db/schema/citation-events'
import { conversations } from '@/lib/db/schema/conversations'

export interface CitationScopeFilter {
  start: Date
  endExclusive: Date
  organizationIds: readonly string[]
  projectIds: readonly string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const boundList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )

export function citationScopeWhere(
  filter: CitationScopeFilter,
  alias: 'e' | 'citation_events' = 'citation_events'
): SQL {
  const table = sql.identifier(alias)
  const parts: SQL[] = [
    sql`${table}.created_at >= ${filter.start.toISOString()}::timestamptz`,
    sql`${table}.created_at < ${filter.endExclusive.toISOString()}::timestamptz`,
  ]
  if (filter.organizationIds.length > 0) {
    parts.push(sql`${table}.organization_id in (${boundList(filter.organizationIds)})`)
  }
  if (filter.projectIds.length > 0) {
    const projectIds = filter.projectIds.filter((id) => UUID.test(id))
    parts.push(
      projectIds.length === 0
        ? sql`false`
        : sql`exists (
            select 1 from ${conversations} scope_c
            where scope_c.id = ${table}.conversation_id
              and scope_c.organization_id = ${table}.organization_id
              and scope_c.project_id in (${sql.join(
                projectIds.map((id) => sql`${id}::uuid`),
                sql`, `
              )})
          )`
    )
  }
  return sql.join(parts, sql` and `)
}

export async function insertCitationEvents(events: NewCitationEvent[]): Promise<number> {
  if (events.length === 0) return 0
  const db = getDb()
  const inserted = await db
    .insert(citationEvents)
    .values(events)
    .onConflictDoNothing({ target: [citationEvents.turnId, citationEvents.kind] })
    .returning({ id: citationEvents.id })
  return inserted.length
}

export interface KindTotalRow {
  kind: CitationEventKind
  turns: number
  items: number
}

export async function aggregateByKind(filter: CitationScopeFilter): Promise<KindTotalRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      kind: citationEvents.kind,
      turns: sql<string>`count(distinct ${citationEvents.turnId})`,
      items: sql<string>`coalesce(sum(${citationEvents.count}), 0)`,
    })
    .from(citationEvents)
    .where(citationScopeWhere(filter))
    .groupBy(citationEvents.kind)

  return rows.map((row) => ({
    kind: row.kind as CitationEventKind,
    turns: Number(row.turns),
    items: Number(row.items),
  }))
}

export async function countObservedTurns(filter: CitationScopeFilter): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ turns: sql<string>`count(distinct ${citationEvents.turnId})` })
    .from(citationEvents)
    .where(citationScopeWhere(filter))
  return Number(row?.turns ?? 0)
}

export async function countDefectiveTurns(filter: CitationScopeFilter): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ turns: sql<string>`count(distinct ${citationEvents.turnId})` })
    .from(citationEvents)
    .where(
      and(
        citationScopeWhere(filter),
        ne(citationEvents.kind, CITATION_BASELINE_KIND),
        ne(citationEvents.kind, CITATION_PRECISION_KIND)
      )
    )
  return Number(row?.turns ?? 0)
}

export interface DailyTurnRow {
  day: string
  turns: number
  defectTurns: number
}

export async function aggregateDailyTurns(filter: CitationScopeFilter): Promise<DailyTurnRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${citationEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      turns: sql<string>`count(distinct ${citationEvents.turnId})`,
      defectTurns: sql<string>`count(distinct ${citationEvents.turnId}) filter (where ${citationEvents.kind} <> ${CITATION_BASELINE_KIND} and ${citationEvents.kind} <> ${CITATION_PRECISION_KIND})`,
    })
    .from(citationEvents)
    .where(citationScopeWhere(filter))
    .groupBy(sql`date_trunc('day', ${citationEvents.createdAt} at time zone 'UTC')`)

  return rows.map((row) => ({
    day: row.day,
    turns: Number(row.turns),
    defectTurns: Number(row.defectTurns ?? 0),
  }))
}

export interface DailyKindRow {
  day: string
  kind: CitationEventKind
  turns: number
}

export async function aggregateDailyByKind(filter: CitationScopeFilter): Promise<DailyKindRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${citationEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      kind: citationEvents.kind,
      turns: sql<string>`count(distinct ${citationEvents.turnId})`,
    })
    .from(citationEvents)
    .where(citationScopeWhere(filter))
    .groupBy(
      sql`date_trunc('day', ${citationEvents.createdAt} at time zone 'UTC')`,
      citationEvents.kind
    )

  return rows.map((row) => ({
    day: row.day,
    kind: row.kind as CitationEventKind,
    turns: Number(row.turns),
  }))
}

export interface ReasonTotalRow {
  kind: CitationEventKind
  reason: string
  occurrences: number
}

const REASONS_PER_KIND = 20

export async function aggregateReasons(filter: CitationScopeFilter): Promise<ReasonTotalRow[]> {
  const db = getDb()
  const rows = await db.execute<{ kind: string; reason: string; occurrences: string }>(sql`
    with per_reason as (
      select
        e.kind as kind,
        r.key as reason,
        coalesce(sum((r.value)::int), 0) as occurrences
      from ${citationEvents} e
      cross join lateral jsonb_each_text(e.reasons) r
      -- jsonb_each_text ERRORS on an array or scalar, so the type check must gate
      -- the lateral join, not merely filter its output.
      where ${citationScopeWhere(filter, 'e')} and jsonb_typeof(e.reasons) = 'object'
      group by e.kind, r.key
    ),
    ranked as (
      select kind, reason, occurrences,
        row_number() over (partition by kind order by occurrences desc, reason) as position
      from per_reason
    )
    select kind, reason, occurrences
    from ranked
    where position <= ${REASONS_PER_KIND}
    order by occurrences desc, kind, reason
  `)

  return Array.from(rows).map((row) => ({
    kind: row.kind as CitationEventKind,
    reason: row.reason,
    occurrences: Number(row.occurrences),
  }))
}

export type SourceMixDimension = 'origin' | 'lane' | 'tool'

export interface SourceMixRow {
  dimension: SourceMixDimension
  label: string
  turns: number
}

const SOURCE_MIX_PER_DIMENSION = 12

const SOURCE_MIX_DIMENSIONS: readonly SourceMixDimension[] = ['origin', 'lane', 'tool']

export async function aggregateDefectiveSourceMix(
  filter: CitationScopeFilter
): Promise<SourceMixRow[]> {
  const db = getDb()
  const rows = await db.execute<{ dimension: string; label: string; turns: string }>(sql`
    with defective as (
      select distinct e.turn_id
      from ${citationEvents} e
      where ${citationScopeWhere(filter, 'e')}
        and e.kind <> ${CITATION_BASELINE_KIND}
        and e.kind <> ${CITATION_PRECISION_KIND}
    ),
    baseline as (
      select e.detail
      from ${citationEvents} e
      join defective d on d.turn_id = e.turn_id
      where ${citationScopeWhere(filter, 'e')} and e.kind = ${CITATION_BASELINE_KIND} and e.detail is not null
    ),
    labels as (
      select 'origin' as dimension, o.key as label
      from baseline, lateral jsonb_each_text(baseline.detail -> 'origins') o
      where jsonb_typeof(baseline.detail -> 'origins') = 'object'
      union all
      select 'lane' as dimension, l.key as label
      from baseline, lateral jsonb_each_text(baseline.detail -> 'lanes') l
      where jsonb_typeof(baseline.detail -> 'lanes') = 'object'
      union all
      select 'tool' as dimension, t.key as label
      from baseline, lateral jsonb_each_text(baseline.detail -> 'tools') t
      where jsonb_typeof(baseline.detail -> 'tools') = 'object'
    ),
    counted as (
      select dimension, label, count(*) as turns,
        row_number() over (partition by dimension order by count(*) desc, label) as position
      from labels
      group by dimension, label
    )
    select dimension, label, turns
    from counted
    where position <= ${SOURCE_MIX_PER_DIMENSION}
    order by turns desc, dimension, label
  `)

  return Array.from(rows).map((row) => ({
    dimension: SOURCE_MIX_DIMENSIONS.find((dimension) => dimension === row.dimension) ?? 'origin',
    label: row.label,
    turns: Number(row.turns),
  }))
}

export interface BoundedRows<T> {
  rows: T[]
  total: number
}

export interface FailedTargetRow {
  target: string
  reason: string
  turns: number
  organizations: number
  lastSeenAt: Date
}

export const FAILED_TARGET_SCAN_CAP = 1000

export async function aggregateFailedTargets(
  filter: CitationScopeFilter
): Promise<BoundedRows<FailedTargetRow>> {
  const db = getDb()
  const rows = await db.execute<{
    target: string
    reason: string
    turns: string
    organizations: string
    last_seen_at: string | Date
    total: string
  }>(sql`
    select
      t.target as target,
      -- The reason that actually recurs for this target; max() would pick
      -- the alphabetically last one, which is meaningless here.
      mode() within group (order by t.reason) as reason,
      count(distinct t.turn_id) as turns,
      count(distinct t.organization_id) as organizations,
      max(t.created_at) as last_seen_at,
      count(*) over () as total
    from (
      select
        e.turn_id,
        e.organization_id,
        e.created_at,
        item ->> 'target' as target,
        coalesce(item ->> 'reason', 'unverifiable') as reason
      from ${citationEvents} e
      cross join lateral jsonb_array_elements(e.detail -> 'targets') item
      where ${citationScopeWhere(filter, 'e')}
        and jsonb_typeof(e.detail -> 'targets') = 'array'
        and item ->> 'target' is not null
    ) t
    group by t.target
    order by turns desc, organizations desc, target
    limit ${FAILED_TARGET_SCAN_CAP}
  `)

  const list = Array.from(rows)
  return {
    total: Number(list[0]?.total ?? 0),
    rows: list.map((row) => ({
      target: row.target,
      reason: row.reason,
      turns: Number(row.turns),
      organizations: Number(row.organizations),
      lastSeenAt: new Date(row.last_seen_at),
    })),
  }
}

export async function countTurnsForTargets(
  filter: CitationScopeFilter,
  targets: string[]
): Promise<number> {
  if (targets.length === 0) return 0
  const db = getDb()
  const list = sql.join(
    targets.map((target) => sql`${target}`),
    sql`, `
  )
  const rows = await db.execute<{ turns: string }>(sql`
    select count(distinct t.turn_id) as turns
    from (
      select e.turn_id, item ->> 'target' as target
      from ${citationEvents} e
      cross join lateral jsonb_array_elements(e.detail -> 'targets') item
      where ${citationScopeWhere(filter, 'e')}
        and jsonb_typeof(e.detail -> 'targets') = 'array'
    ) t
    where t.target in (${list})
  `)
  return Number(Array.from(rows)[0]?.turns ?? 0)
}

export interface UnavailableToolRow {
  tool: string
  turns: number
}

const UNAVAILABLE_TOOL_LIMIT = 8

export async function aggregateUnavailableTools(
  filter: CitationScopeFilter
): Promise<BoundedRows<UnavailableToolRow>> {
  const db = getDb()
  const rows = await db.execute<{ tool: string; turns: string; total: string }>(sql`
    select tool, count(*) as turns, count(*) over () as total
    from (
      select jsonb_array_elements_text(e.detail -> 'unavailable_tools') as tool
      from ${citationEvents} e
      where ${citationScopeWhere(filter, 'e')}
        and e.kind = 'registry_empty'
        and jsonb_typeof(e.detail -> 'unavailable_tools') = 'array'
    ) tools
    group by tool
    order by turns desc, tool
    limit ${UNAVAILABLE_TOOL_LIMIT}
  `)

  const list = Array.from(rows)
  return {
    total: Number(list[0]?.total ?? 0),
    rows: list.map((row) => ({ tool: row.tool, turns: Number(row.turns) })),
  }
}

export interface OrganizationTotalRow {
  organizationId: string | null
  turns: number
  defectTurns: number
  errorTurns: number
}

export const ORGANIZATION_SCAN_CAP = 1000

export async function aggregateByOrganization(
  filter: CitationScopeFilter
): Promise<BoundedRows<OrganizationTotalRow>> {
  const db = getDb()
  const rows = await db.execute<{
    organization_id: string | null
    turns: string
    defect_turns: string
    error_turns: string
    total: string
  }>(sql`
    select
      e.organization_id,
      count(distinct e.turn_id) as turns,
      count(distinct e.turn_id) filter (
        where e.kind <> ${CITATION_BASELINE_KIND} and e.kind <> ${CITATION_PRECISION_KIND}
      ) as defect_turns,
      count(distinct e.turn_id) filter (where e.severity = 'error') as error_turns,
      count(*) over () as total
    from ${citationEvents} e
    where ${citationScopeWhere(filter, 'e')}
    group by e.organization_id
    order by defect_turns desc, turns desc, e.organization_id
    limit ${ORGANIZATION_SCAN_CAP}
  `)

  const list = Array.from(rows)
  return {
    total: Number(list[0]?.total ?? 0),
    rows: list.map((row) => ({
      organizationId: row.organization_id,
      turns: Number(row.turns),
      defectTurns: Number(row.defect_turns),
      errorTurns: Number(row.error_turns),
    })),
  }
}

const RECENT_LIMIT = 25

export async function listRecentDefects(
  filter: CitationScopeFilter,
  limit = RECENT_LIMIT
): Promise<CitationEvent[]> {
  const db = getDb()
  return db
    .select()
    .from(citationEvents)
    .where(
      and(
        citationScopeWhere(filter),
        ne(citationEvents.kind, CITATION_BASELINE_KIND),
        ne(citationEvents.kind, CITATION_PRECISION_KIND)
      )
    )
    .orderBy(desc(citationEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), RECENT_LIMIT))
}

export const EXPORT_ROW_CAP = 5000

export async function listEventsForExport(
  filter: CitationScopeFilter,
  limit = EXPORT_ROW_CAP
): Promise<CitationEvent[]> {
  const db = getDb()
  return (
    db
      .select()
      .from(citationEvents)
      .where(citationScopeWhere(filter))
      .orderBy(citationEvents.createdAt)
      .limit(Math.min(Math.max(limit, 1), EXPORT_ROW_CAP) + 1)
  )
}
