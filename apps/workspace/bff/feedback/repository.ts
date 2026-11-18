import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { answerFeedback, type AnswerFeedback, type AnswerFeedbackReason, type AnswerFeedbackVerdict } from '@/lib/db/schema/answer-feedback'
import { isConversationTagKey, type ConversationTagKey } from '@/lib/conversations/tags'
import { executeRows } from '@/lib/db/execute-rows'
import { rangeDays, scopeBounds, type QualityScope } from '@/lib/quality/scope'
import type { FeedbackQuery, RatingsFilters } from './filters'
import { VOTED_ANSWER_JOIN } from './turn-join'
import { OUTSIDE_RESTRICTED_USE, sqlList, VOTE_PROJECT, voteScope } from './vote-scope'
import { isTraceId } from '@/lib/langfuse/config'

export { OUTSIDE_RESTRICTED_USE }

export const CONVERSATION_FEEDBACK_LIST_LIMIT = 200

export interface UpsertAnswerFeedbackValues {
  organizationId: string
  projectId: string | null
  conversationId: string | null
  messageId: string
  userId: string
  verdict: AnswerFeedbackVerdict
  reason: AnswerFeedbackReason | null
  comment: string | null
  expectedAnswer: string | null
  lessonsHoldout?: boolean | null
}

export async function getAnswerFeedbackForUser(
  userId: string,
  messageId: string
): Promise<AnswerFeedback | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(answerFeedback)
    .where(and(eq(answerFeedback.userId, userId), eq(answerFeedback.messageId, messageId)))
    .limit(1)
  return row ?? null
}

export async function upsertAnswerFeedback(values: UpsertAnswerFeedbackValues): Promise<AnswerFeedback> {
  const db = getDb()
  const [row] = await db
    .insert(answerFeedback)
    .values(values)
    .onConflictDoUpdate({
      target: [answerFeedback.userId, answerFeedback.messageId],
      set: {
        verdict: values.verdict,
        reason: values.reason,
        comment: values.comment,
        expectedAnswer: values.expectedAnswer,
        conversationId: values.conversationId,
        projectId: values.projectId,
        organizationId: values.organizationId,
        lessonsHoldout: values.lessonsHoldout ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

export async function deleteAnswerFeedbackForUser(
  userId: string,
  messageId: string,
  organizationId: string,
): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .delete(answerFeedback)
    .where(
      and(
        eq(answerFeedback.userId, userId),
        eq(answerFeedback.messageId, messageId),
        eq(answerFeedback.organizationId, organizationId),
      ),
    )
    .returning({ id: answerFeedback.id })
  return rows[0]?.id ?? null
}

const ANSWER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getAnswerTraceId(messageId: string, organizationId: string): Promise<string | null> {
  if (!ANSWER_ID.test(messageId)) return null
  const db = getDb()
  const rows = rowsOf(
    await db.execute(sql`
      select metadata->>'trace_id' as trace_id
      from messages
      where id = ${messageId}::uuid
        and organization_id = ${organizationId}
        and role = 'assistant'
      limit 1
    `),
  )
  const traceId = rows[0]?.trace_id
  return isTraceId(traceId) ? traceId : null
}

export async function isRestrictedUseVote(feedbackId: string, organizationId: string): Promise<boolean> {
  const rows = rowsOf(
    await getDb().execute(sql`
      select 1
      from answer_feedback f
      where f.id = ${feedbackId}
        and f.organization_id = ${organizationId}
        and not (${OUTSIDE_RESTRICTED_USE})
      limit 1
    `),
  )
  return rows.length > 0
}

export async function getPersistedAnswerConversationId(
  messageId: string,
  organizationId: string,
): Promise<string | null> {
  if (!ANSWER_ID.test(messageId)) return null
  const db = getDb()
  const rows = rowsOf(
    await db.execute(sql`
      select conversation_id
      from messages
      where id = ${messageId}::uuid
        and organization_id = ${organizationId}
        and role = 'assistant'
      limit 1
    `),
  )
  const conversationId = rows[0]?.conversation_id
  return typeof conversationId === 'string' && conversationId ? conversationId : null
}

export async function listAnswerFeedbackForConversation(
  userId: string,
  conversationId: string,
  organizationId: string,
  limit = CONVERSATION_FEEDBACK_LIST_LIMIT,
): Promise<AnswerFeedback[]> {
  const db = getDb()
  return db
    .select()
    .from(answerFeedback)
    .where(
      and(
        eq(answerFeedback.organizationId, organizationId),
        eq(answerFeedback.userId, userId),
        eq(answerFeedback.conversationId, conversationId),
      ),
    )
    .orderBy(desc(answerFeedback.createdAt))
    .limit(limit)
}

export const FEEDBACK_HEALTH_RECENT_LIMIT = 50

export const FEEDBACK_EXPORT_ROW_CAP = 5000

export const FEEDBACK_ORG_ROLLUP_LIMIT = 500
export const FEEDBACK_TOPIC_ROLLUP_LIMIT = 100

export interface FeedbackHealthTotals {
  up: number
  down: number
  voters: number
  downVoters: number
}

export interface FeedbackReasonCount {
  reason: AnswerFeedbackReason
  count: number
}

export interface FeedbackDailyPoint {
  day: string
  up: number
  down: number
}

export interface FeedbackOrgRollup {
  organizationId: string
  up: number
  down: number
  voters: number
}

export interface FeedbackTopicRollup {
  topic: ConversationTagKey
  up: number
  down: number
  voters: number
}

export interface FeedbackTurn {
  id: string
  organizationId: string
  projectId: string | null
  conversationId: string | null
  messageId: string
  verdict: AnswerFeedbackVerdict
  reason: AnswerFeedbackReason | null
  comment: string | null
  expectedAnswer: string | null
  createdAt: Date
  answer: string | null
  question: string | null
  conversationTitle: string | null
  topics: ConversationTagKey[]
  traceId: string | null
}

export interface FeedbackHealth {
  from: string
  to: string
  windowDays: number
  answers: number
  ratedAnswers: number
  coverage: number | null
  totals: FeedbackHealthTotals
  reasons: FeedbackReasonCount[]
  daily: FeedbackDailyPoint[]
  organizations: FeedbackOrgRollup[]
  topics: FeedbackTopicRollup[]
  turns: FeedbackTurn[]
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return executeRows(result)
}

const VERDICT_COUNTS = sql`
  count(*) filter (where f.verdict = 'up')   as up,
  count(*) filter (where f.verdict = 'down') as down
`

export async function getFeedbackHealth(
  query: FeedbackQuery,
  options: { turnLimit?: number } = {},
): Promise<FeedbackHealth> {
  const db = getDb()
  const { scope, ratings } = query
  const votes = voteScope(query)
  const { start, endExclusive } = scopeBounds(scope)

  const coverageRows = await db.execute(sql`
    with produced as (
      select m.id::text as message_id
      from messages m
      join conversations c on c.id = m.conversation_id
      where m.role = 'assistant'
        and m.created_at >= ${start.toISOString()}::timestamptz
        and m.created_at < ${endExclusive.toISOString()}::timestamptz
        ${scope.organizationIds.length ? sql`and c.organization_id in (${sqlList(scope.organizationIds)})` : sql``}
        ${scope.projectIds.length ? sql`and c.project_id in (${sqlList(scope.projectIds)})` : sql``}
        ${ratings.topics.length ? sql`and c.tags && array[${sqlList(ratings.topics)}]::text[]` : sql``}
    ),
    rated as (
      select distinct f.message_id
      ${votes}
    )
    select
      (select count(*) from (select message_id from produced union select message_id from rated) u) as answers,
      (select count(*) from rated) as rated_answers
  `)
  const [coverageRow] = rowsOf(coverageRows)
  const answers = Number(coverageRow?.answers ?? 0)
  const ratedAnswers = Number(coverageRow?.rated_answers ?? 0)

  const [totalsRow] = rowsOf(
    await db.execute(sql`
      select
        ${VERDICT_COUNTS},
        count(distinct f.user_id)                                    as voters,
        count(distinct f.user_id) filter (where f.verdict = 'down')  as down_voters
      ${votes}
    `),
  )

  const reasonRows = rowsOf(
    await db.execute(sql`
      select coalesce(f.reason, 'other') as reason, count(*) as count
      ${votes}
        and f.verdict = 'down'
      group by 1
    `),
  )

  const dailyRows = rowsOf(
    await db.execute(sql`
      select to_char(date_trunc('day', f.created_at at time zone 'UTC'), 'YYYY-MM-DD') as day, ${VERDICT_COUNTS}
      ${votes}
      group by 1
      order by 1
    `),
  )

  const organizationRows = rowsOf(
    await db.execute(sql`
      select f.organization_id, ${VERDICT_COUNTS}, count(distinct f.user_id) as voters
      ${votes}
      group by f.organization_id
      order by down desc, count(*) desc, f.organization_id
      limit ${FEEDBACK_ORG_ROLLUP_LIMIT}
    `),
  )

  const topicRows = rowsOf(
    await db.execute(sql`
      select tag as topic, ${VERDICT_COUNTS}, count(distinct f.user_id) as voters
      ${voteScope(query, { extraJoins: sql`cross join lateral unnest(c.tags) as tag` })}
      group by tag
      order by count(*) desc
      limit ${FEEDBACK_TOPIC_ROLLUP_LIMIT}
    `),
  )

  const turnLimit = options.turnLimit ?? FEEDBACK_HEALTH_RECENT_LIMIT
  const turns = turnLimit > 0 ? await listFeedbackTurns(query, { limit: turnLimit }) : []

  return {
    from: scope.from,
    to: scope.to,
    windowDays: rangeDays(scope.from, scope.to),
    answers,
    ratedAnswers,
    coverage: answers > 0 ? ratedAnswers / answers : null,
    totals: {
      up: Number(totalsRow?.up ?? 0),
      down: Number(totalsRow?.down ?? 0),
      voters: Number(totalsRow?.voters ?? 0),
      downVoters: Number(totalsRow?.down_voters ?? 0),
    },
    reasons: reasonRows.map((row) => ({
      reason: String(row.reason) as AnswerFeedbackReason,
      count: Number(row.count ?? 0),
    })),
    daily: dailyRows.map((row) => ({ day: String(row.day), up: Number(row.up ?? 0), down: Number(row.down ?? 0) })),
    organizations: organizationRows.map((row) => ({
      organizationId: String(row.organization_id),
      up: Number(row.up ?? 0),
      down: Number(row.down ?? 0),
      voters: Number(row.voters ?? 0),
    })),
    topics: topicRows.flatMap((row) => {
      const key = String(row.topic ?? '')
      return isConversationTagKey(key)
        ? [{ topic: key, up: Number(row.up ?? 0), down: Number(row.down ?? 0), voters: Number(row.voters ?? 0) }]
        : []
    }),
    turns,
  }
}

export async function listFeedbackTurns(
  query: FeedbackQuery,
  options: { limit?: number; verdict?: AnswerFeedbackVerdict } = {},
): Promise<FeedbackTurn[]> {
  const { ratings } = query
  if (options.verdict && ratings.verdict && options.verdict !== ratings.verdict) return []
  if (options.verdict === 'up' && ratings.reasons.length) return []
  const narrowed: FeedbackQuery = options.verdict
    ? { ...query, ratings: { ...ratings, verdict: options.verdict } }
    : query
  const limit = options.limit ?? FEEDBACK_HEALTH_RECENT_LIMIT
  const recentLimit = Math.max(0, Math.min(limit, FEEDBACK_EXPORT_ROW_CAP + 1))
  const db = getDb()

  const result = await db.execute(sql`
    select
      f.id,
      f.organization_id,
      f.project_id,
      coalesce(m.conversation_id, f.conversation_id) as conversation_id,
      f.message_id,
      f.verdict,
      f.reason,
      f.comment,
      f.expected_answer,
      f.created_at,
      m.content    as answer,
      q.content    as question,
      c.title      as conversation_title,
      c.tags       as topics,
      m.metadata->>'trace_id' as trace_id
    ${voteScope(narrowed, { question: true, contentBearing: true })}
    order by f.created_at desc, f.id
    limit ${recentLimit}
  `)

  const rows = rowsOf(result)
  return rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: (row.project_id as string | null) ?? null,
    conversationId: (row.conversation_id as string | null) ?? null,
    messageId: String(row.message_id),
    verdict: row.verdict as AnswerFeedbackVerdict,
    reason: (row.reason as AnswerFeedbackReason | null) ?? null,
    comment: typeof row.comment === 'string' && row.comment.trim() ? row.comment : null,
    expectedAnswer:
      typeof row.expected_answer === 'string' && row.expected_answer.trim()
        ? row.expected_answer
        : null,
    createdAt: new Date(row.created_at as string),
    answer: (row.answer as string | null) ?? null,
    question: (row.question as string | null) ?? null,
    conversationTitle: (row.conversation_title as string | null) ?? null,
    topics: Array.isArray(row.topics)
      ? (row.topics as unknown[]).map(String).filter(isConversationTagKey)
      : [],
    traceId: isTraceId(row.trace_id) ? row.trace_id : null,
  }))
}

export const FEEDBACK_WEEKLY_SUMMARY_LIMIT = 5000

export interface FeedbackWeeklyCount {
  organizationId: string
  isoWeek: string
  weekStart: string
  answers: number
  ratedAnswers: number
  up: number
  down: number
}

export interface FeedbackWeeklySummary {
  weeks: FeedbackWeeklyCount[]
  truncated: boolean
  cap: number
}

export function weeklyWindowStart(scope: Pick<QualityScope, 'from'>): string {
  return isoWeekStart(new Date(`${scope.from}T00:00:00Z`))
}

export function isoWeekStart(instant: Date): string {
  const day = (instant.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() - day),
  ).toISOString()
}

export const WEEKLY_APPLIED_RATINGS_FILTERS = ['topics'] as const satisfies readonly (keyof RatingsFilters)[]

export async function getFeedbackWeeklySummary(query: FeedbackQuery): Promise<FeedbackWeeklySummary> {
  const { scope, ratings } = query
  const db = getDb()
  const since = weeklyWindowStart(scope)
  const until = scopeBounds(scope).endExclusive.toISOString()
  const orgs = scope.organizationIds
  const projects = scope.projectIds
  const topics = ratings.topics

  const result = await db.execute(sql`
    with produced as (
      select
        c.organization_id,
        date_trunc('week', m.created_at at time zone 'UTC') as week,
        m.id::text as message_id
      from messages m
      join conversations c on c.id = m.conversation_id
      where m.role = 'assistant'
        and m.created_at >= ${since}::timestamptz
        and m.created_at < ${until}::timestamptz
        ${orgs.length ? sql`and c.organization_id in (${sqlList(orgs)})` : sql``}
        ${projects.length ? sql`and c.project_id in (${sqlList(projects)})` : sql``}
        ${topics.length ? sql`and c.tags && array[${sqlList(topics)}]::text[]` : sql``}
    ),
    votes as (
      select
        f.organization_id,
        date_trunc('week', f.created_at at time zone 'UTC') as week,
        f.message_id,
        f.verdict
      from answer_feedback f
      ${VOTED_ANSWER_JOIN}
      left join conversations c
        on c.id = coalesce(m.conversation_id, f.conversation_id)
       and c.organization_id = f.organization_id
      where f.created_at >= ${since}::timestamptz
        and f.created_at < ${until}::timestamptz
        ${orgs.length ? sql`and f.organization_id in (${sqlList(orgs)})` : sql``}
        ${projects.length ? sql`and ${VOTE_PROJECT} in (${sqlList(projects)})` : sql``}
        ${topics.length ? sql`and c.tags && array[${sqlList(topics)}]::text[]` : sql``}
    ),
    a as (
      select organization_id, week, count(*) as answers
      from (
        select organization_id, week, message_id from produced
        union
        select organization_id, week, message_id from votes
      ) u
      group by 1, 2
    ),
    v as (
      select
        organization_id,
        week,
        count(distinct message_id)                  as rated_answers,
        count(*) filter (where verdict = 'up')      as up,
        count(*) filter (where verdict = 'down')    as down
      from votes
      group by 1, 2
    )
    select
      a.organization_id,
      to_char(a.week, 'IYYY-"W"IW')   as iso_week,
      to_char(a.week, 'YYYY-MM-DD')   as week_start,
      a.answers,
      coalesce(v.rated_answers, 0)    as rated_answers,
      coalesce(v.up, 0)               as up,
      coalesce(v.down, 0)             as down
    from a
    left join v on v.organization_id = a.organization_id and v.week = a.week
    order by week_start desc, a.organization_id
    limit ${FEEDBACK_WEEKLY_SUMMARY_LIMIT + 1}
  `)

  const rows = rowsOf(result)
  const truncated = rows.length > FEEDBACK_WEEKLY_SUMMARY_LIMIT
  const weeks = rows.slice(0, FEEDBACK_WEEKLY_SUMMARY_LIMIT).map((row) => ({
    organizationId: String(row.organization_id),
    isoWeek: String(row.iso_week),
    weekStart: String(row.week_start),
    answers: Number(row.answers ?? 0),
    ratedAnswers: Number(row.rated_answers ?? 0),
    up: Number(row.up ?? 0),
    down: Number(row.down ?? 0),
  }))
  return { weeks, truncated, cap: FEEDBACK_WEEKLY_SUMMARY_LIMIT }
}
