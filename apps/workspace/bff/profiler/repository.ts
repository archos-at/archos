import 'server-only'
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withOptionalTenant, withPlatformAccess } from '@/lib/db/tenant-context'
import { escapeLikePattern } from '@/lib/text/like-pattern'
import { agentProfilerSpans, type AgentProfilerSpan, type NewAgentProfilerSpan } from '@/lib/db/schema/agent-profiler'
import { conversations } from '@/lib/db/schema/conversations'

const PROFILER_ACCESS_REASON =
  'platform profiler: a deliberately cross-organization operations directory'

export async function insertSpans(spans: NewAgentProfilerSpan[]): Promise<number> {
  if (spans.length === 0) return 0
  const db = getDb()
  const inserted = await withOptionalTenant(
    spans[0].organizationId ?? null,
    'profiler spans from a turn with no organization selected belong to no tenant',
    () => db.insert(agentProfilerSpans).values(spans).returning({ id: agentProfilerSpans.id })
  )
  return inserted.length
}

export interface ProfiledConversationRow {
  conversationId: string
  organizationId: string | null
  title: string | null
  titleWithheld: boolean
  turnCount: number
  totalDurationMs: number
  lastActiveAt: Date
}

const CONVERSATION_LIST_CAP = 200

const SPAN_ORGANIZATION = sql`coalesce(${conversations.organizationId}, ${agentProfilerSpans.organizationId})`

const RESTRICTED_USE = sql`conversation_restricted_use(${SPAN_ORGANIZATION}, ${agentProfilerSpans.conversationId})`

export interface ProfiledConversationFilter {
  start: Date
  endExclusive: Date
  organizationIds: readonly string[]
  projectIds: readonly string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scopeConditions(filter: ProfiledConversationFilter): SQL[] {
  const conditions: SQL[] = [
    eq(agentProfilerSpans.kind, 'turn'),
    isNotNull(agentProfilerSpans.conversationId),
    gte(agentProfilerSpans.startedAt, filter.start),
    lt(agentProfilerSpans.startedAt, filter.endExclusive),
  ]
  if (filter.organizationIds.length > 0) {
    conditions.push(
      inArray(
        sql`coalesce(${conversations.organizationId}, ${agentProfilerSpans.organizationId})`,
        [...filter.organizationIds]
      )
    )
  }
  if (filter.projectIds.length > 0) {
    const projectIds = filter.projectIds.filter((id) => UUID.test(id))
    conditions.push(
      projectIds.length > 0 ? inArray(conversations.projectId, projectIds) : sql`false`
    )
  }
  return conditions
}

async function selectConversations(conditions: SQL[], limit: number) {
  const db = getDb()
  const rows = await withPlatformAccess(PROFILER_ACCESS_REASON, () =>
    db
      .select({
        conversationId: agentProfilerSpans.conversationId,
        organizationId: sql<
          string | null
        >`max(coalesce(${conversations.organizationId}, ${agentProfilerSpans.organizationId}))`,
        title: sql<
          string | null
        >`max(case when ${RESTRICTED_USE} then null else ${conversations.title} end)`,
        titleWithheld: sql<boolean>`bool_or(${RESTRICTED_USE})`,
        turnCount: sql<number>`count(*)::int`,
        totalDurationMsRaw: sql<string>`coalesce(sum(${agentProfilerSpans.durationMs}), 0)::bigint`,
        lastActiveAt: sql<Date>`max(${agentProfilerSpans.startedAt})`,
      })
      .from(agentProfilerSpans)
      .leftJoin(conversations, eq(conversations.id, agentProfilerSpans.conversationId))
      .where(and(...conditions))
      .groupBy(agentProfilerSpans.conversationId)
      .orderBy(desc(sql`max(${agentProfilerSpans.startedAt})`))
      .limit(limit)
  )
  return rows.map((row): ProfiledConversationRow => ({
    conversationId: row.conversationId as string,
    organizationId: row.organizationId,
    title: row.title,
    titleWithheld: row.titleWithheld === true,
    turnCount: Number(row.turnCount),
    totalDurationMs: Number(row.totalDurationMsRaw),
    lastActiveAt: new Date(row.lastActiveAt),
  }))
}

export async function listProfiledConversations(
  filter: ProfiledConversationFilter,
  query?: string
): Promise<{
  rows: ProfiledConversationRow[]
  capped: boolean
}> {
  const conditions = scopeConditions(filter)
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`
    conditions.push(
      or(
        ilike(agentProfilerSpans.conversationId, pattern),
        and(ilike(conversations.title, pattern), sql`not ${RESTRICTED_USE}`)
      ) as SQL
    )
  }
  const rows = await selectConversations(conditions, CONVERSATION_LIST_CAP + 1)
  return {
    capped: rows.length > CONVERSATION_LIST_CAP,
    rows: rows.slice(0, CONVERSATION_LIST_CAP),
  }
}

export async function findProfiledConversation(
  filter: ProfiledConversationFilter,
  conversationId: string
): Promise<ProfiledConversationRow | null> {
  const rows = await selectConversations(
    [...scopeConditions(filter), eq(agentProfilerSpans.conversationId, conversationId)],
    1
  )
  return rows[0] ?? null
}

export const TIMELINE_TURN_CAP = 50
export const TIMELINE_SPAN_CAP = 5000

export interface ConversationSpans {
  spans: AgentProfilerSpan[]
  totalTurns: number
  capped: boolean
}

export async function getSpansForConversation(conversationId: string): Promise<ConversationSpans> {
  const db = getDb()
  return withPlatformAccess(PROFILER_ACCESS_REASON, async () => {
    const turnRows = await db
      .select({
        turnId: agentProfilerSpans.turnId,
        totalTurns: sql<string>`count(*) over ()`,
      })
      .from(agentProfilerSpans)
      .where(eq(agentProfilerSpans.conversationId, conversationId))
      .groupBy(agentProfilerSpans.turnId)
      .orderBy(desc(sql`min(${agentProfilerSpans.startedAt})`))
      .limit(TIMELINE_TURN_CAP)

    const totalTurns = Number(turnRows[0]?.totalTurns ?? 0)
    if (turnRows.length === 0) return { spans: [], totalTurns: 0, capped: false }

    const spans = await db
      .select()
      .from(agentProfilerSpans)
      .where(
        and(
          eq(agentProfilerSpans.conversationId, conversationId),
          inArray(
            agentProfilerSpans.turnId,
            turnRows.map((row) => row.turnId)
          )
        )
      )
      .orderBy(desc(agentProfilerSpans.startedAt), desc(agentProfilerSpans.spanId))
      .limit(TIMELINE_SPAN_CAP + 1)

    const spansCapped = spans.length > TIMELINE_SPAN_CAP
    return {
      spans: spans.slice(0, TIMELINE_SPAN_CAP).reverse(),
      totalTurns,
      capped: spansCapped || totalTurns > turnRows.length,
    }
  })
}
