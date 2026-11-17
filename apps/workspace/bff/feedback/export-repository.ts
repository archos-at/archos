import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { executeRows } from '@/lib/db/execute-rows'
import type { AnswerFeedbackReason, AnswerFeedbackVerdict } from '@/lib/db/schema/answer-feedback'
import type { PlatformLessonStatus } from '@/lib/db/schema/platform-lessons'
import { isConversationTagKey, type ConversationTagKey } from '@/lib/conversations/tags'
import { sanitizeProvenance, type MessageProvenance } from '@/lib/conversations/message-provenance'
import { isTraceId } from '@/lib/langfuse/config'
import {
  FEEDBACK_CONFIDENCE_FILTERS,
  FEEDBACK_MODE_FILTERS,
  FEEDBACK_REASON_FILTERS,
  type FeedbackConfidenceFilter,
  type FeedbackModeFilter,
  type FeedbackQuery,
  type FeedbackReasonFilter,
} from './filters'
import { FEEDBACK_EXPORT_ROW_CAP, FEEDBACK_TOPIC_ROLLUP_LIMIT } from './repository'
import { ANSWER_CONFIDENCE, ANSWER_JOB_ID, ANSWER_MODE, sqlList, voteScope } from './vote-scope'

export type FeedbackAnswerMode = NonNullable<MessageProvenance['routingDecision']> | 'report'

export type FeedbackLessonStatus = PlatformLessonStatus | 'skipped'

export interface FeedbackExportRow {
  feedbackId: string
  organizationId: string
  projectId: string | null
  projectName: string | null
  bundesland: string | null
  conversationId: string | null
  conversationFound: boolean
  conversationTitle: string | null
  messageId: string
  voterKey: string
  verdict: AnswerFeedbackVerdict
  reason: AnswerFeedbackReason | null
  comment: string | null
  expectedAnswer: string | null
  firstVotedAt: Date
  votedAt: Date
  question: string | null
  answer: string | null
  answeredAt: Date | null
  topics: ConversationTagKey[]
  answerMode: FeedbackAnswerMode | null
  answerConfidence: NonNullable<MessageProvenance['answerConfidence']> | null
  confidenceCappedReason: NonNullable<MessageProvenance['answerConfidenceCappedReason']> | null
  sourcesCited: number | null
  citationsRemoved: number | null
  researchTruncated: boolean | null
  skills: string[]
  clientDurationMs: number | null
  traceId: string | null
  jobId: string | null
  llmCalls: number | null
  models: string[]
  tokensTotal: number | null
  costUsd: number | null
  lessonId: string | null
  lessonStatus: FeedbackLessonStatus | null
  lessonsHoldout: boolean | null
}

export interface FeedbackExportTotals {
  votes: number
  up: number
  down: number
  voters: number
  organizations: number
}

const PROVENANCE_FIELDS = [
  'routingDecision',
  'answerConfidence',
  'answerConfidenceCappedReason',
  'citationsRemoved',
  'researchTruncated',
  'skillsActivated',
  'answerDurationMs',
  'deepResearchJobId',
] as const

const pickedProvenance = sql.raw(
  `jsonb_strip_nulls(jsonb_build_object(${PROVENANCE_FIELDS.map(
    (field) => `'${field}', m.metadata->'provenance'->'${field}'`,
  ).join(', ')}))`,
)

export async function listFeedbackExportRows(
  query: FeedbackQuery,
  limit: number,
): Promise<FeedbackExportRow[]> {
  const bounded = Math.max(0, Math.min(limit, FEEDBACK_EXPORT_ROW_CAP + 1))
  const db = getDb()
  const result = await db.execute(sql`
    with sel as (
      select
        f.id,
        f.organization_id,
        f.message_id,
        f.verdict,
        f.reason,
        f.comment,
        f.expected_answer,
        f.created_at,
        f.updated_at,
        f.lessons_holdout,
        left(encode(sha256(convert_to(f.organization_id || ':' || f.user_id, 'UTF8')), 'hex'), 12) as voter_key,
        coalesce(m.conversation_id, f.conversation_id) as conversation_id,
        c.id is not null                               as conversation_found,
        c.title                                        as conversation_title,
        c.tags                                         as topics,
        coalesce(f.project_id, c.project_id)           as project_id,
        m.content                                      as answer,
        m.created_at                                   as answered_at,
        q.content                                      as question,
        m.metadata->>'trace_id'                        as trace_id,
        ${pickedProvenance}                            as provenance,
        case when jsonb_typeof(m.metadata->'citations'->'sources') = 'array' then (
          select count(*) from jsonb_array_elements(m.metadata->'citations'->'sources') s
          where s->'is_cited' is distinct from 'false'::jsonb
        ) end                                          as sources_cited,
        ${ANSWER_JOB_ID}                               as job_id
      ${voteScope(query, { question: true, contentBearing: true })}
      order by f.created_at desc, f.id
      limit ${bounded}
    ),
    usage_rows as (
      select s.id, u.model, u.total_tokens, u.cost_usd
      from sel s
      join llm_usage_events u
        on u.organization_id = s.organization_id
       and u.conversation_id = s.conversation_id
       and u.message_id = s.message_id
      where s.job_id is null
      union all
      select s.id, u.model, u.total_tokens, u.cost_usd
      from sel s
      join llm_usage_events u
        on u.organization_id = s.organization_id
       and u.job_id = s.job_id
      where s.job_id is not null
    ),
    usage as (
      select
        id,
        count(*)                                                as llm_calls,
        array_agg(distinct model order by model) filter (where model is not null) as models,
        sum(total_tokens)                                       as tokens_total,
        sum(cost_usd)                                           as cost_usd
      from usage_rows
      group by id
    )
    select
      sel.*,
      p.name                                       as project_name,
      coalesce(p.profile->'facts'->'federal_state'->>'value', p.profile->'facts'->'bundesland'->>'value') as bundesland,
      usage.llm_calls,
      usage.models,
      usage.tokens_total,
      usage.cost_usd,
      r.lesson_id,
      r.outcome                                    as lesson_outcome,
      l.status                                     as lesson_status
    from sel
    left join projects p on p.id = sel.project_id and p.organization_id = sel.organization_id
    left join usage on usage.id = sel.id
    left join platform_lesson_reports r on r.feedback_id = sel.id
    left join platform_lessons l on l.id = r.lesson_id
    order by sel.created_at desc, sel.id
  `)
  return executeRows(result).map(toExportRow)
}

export async function getFeedbackExportTotals(query: FeedbackQuery): Promise<FeedbackExportTotals> {
  const db = getDb()
  const [row] = executeRows(
    await db.execute(sql`
      select
        count(*)                                     as votes,
        count(*) filter (where f.verdict = 'up')     as up,
        count(*) filter (where f.verdict = 'down')   as down,
        count(distinct f.user_id)                    as voters,
        count(distinct f.organization_id)            as organizations
      ${voteScope(query)}
    `),
  )
  return {
    votes: Number(row?.votes ?? 0),
    up: Number(row?.up ?? 0),
    down: Number(row?.down ?? 0),
    voters: Number(row?.voters ?? 0),
    organizations: Number(row?.organizations ?? 0),
  }
}

export async function countFeedbackVotes(query: FeedbackQuery, cap: number = FEEDBACK_EXPORT_ROW_CAP): Promise<number> {
  const bounded = Math.max(0, Math.min(cap, FEEDBACK_EXPORT_ROW_CAP)) + 1
  const db = getDb()
  const [row] = executeRows(
    await db.execute(sql`
      select count(*) as votes from (
        select 1
        ${voteScope(query)}
        limit ${bounded}
      ) capped
    `),
  )
  return Number(row?.votes ?? 0)
}

export interface FeedbackFacetCount<Key extends string> {
  key: Key
  votes: number
}

export interface FeedbackFacets {
  verdicts: { up: number; down: number }
  reasons: FeedbackFacetCount<FeedbackReasonFilter>[]
  topics: FeedbackFacetCount<ConversationTagKey>[]
  modes: FeedbackFacetCount<FeedbackModeFilter>[]
  confidences: FeedbackFacetCount<FeedbackConfidenceFilter>[]
  withComment: number
  withExpectedAnswer: number
}

export async function getFeedbackFacets(query: FeedbackQuery): Promise<FeedbackFacets> {
  const db = getDb()
  const rows = executeRows(
    await db.execute(sql`
      with v as (
        select
          f.verdict,
          coalesce(f.reason, 'other')               as reason,
          c.tags                                    as tags,
          ${ANSWER_MODE}                            as mode,
          ${ANSWER_CONFIDENCE}                      as confidence,
          nullif(btrim(f.comment), '') is not null          as has_comment,
          nullif(btrim(f.expected_answer), '') is not null  as has_expected
        ${voteScope(query, { scopeOnly: true })}
      )
      (select 'verdict' as facet, verdict as key, count(*) as votes from v group by verdict)
      union all
      (select 'reason', reason, count(*) from v where verdict = 'down' group by reason)
      union all
      (select 'mode', mode, count(*) from v where mode in (${sqlList(FEEDBACK_MODE_FILTERS)}) group by mode)
      union all
      (select 'confidence', confidence, count(*) from v
        where confidence in (${sqlList(FEEDBACK_CONFIDENCE_FILTERS)}) group by confidence)
      union all
      (select 'topic', tag, count(*) from v cross join lateral unnest(v.tags) as tag
        group by tag order by count(*) desc limit ${FEEDBACK_TOPIC_ROLLUP_LIMIT})
      union all
      (select 'flag', 'has_comment', count(*) filter (where has_comment) from v)
      union all
      (select 'flag', 'has_expected', count(*) filter (where has_expected) from v)
    `),
  )

  const counts = (facet: string): Map<string, number> =>
    new Map(rows.filter((row) => row.facet === facet).map((row) => [String(row.key), Number(row.votes ?? 0)]))
  const facet = <Key extends string>(vocabulary: readonly Key[], facetName: string): FeedbackFacetCount<Key>[] => {
    const byKey = counts(facetName)
    return vocabulary.map((key) => ({ key, votes: byKey.get(key) ?? 0 }))
  }
  const verdicts = counts('verdict')
  const flags = counts('flag')
  const topics = counts('topic')
  return {
    verdicts: { up: verdicts.get('up') ?? 0, down: verdicts.get('down') ?? 0 },
    reasons: facet(FEEDBACK_REASON_FILTERS, 'reason'),
    topics: [...topics.entries()].flatMap(([key, votes]) => (isConversationTagKey(key) ? [{ key, votes }] : [])),
    modes: facet(FEEDBACK_MODE_FILTERS, 'mode'),
    confidences: facet(FEEDBACK_CONFIDENCE_FILTERS, 'confidence'),
    withComment: flags.get('has_comment') ?? 0,
    withExpectedAnswer: flags.get('has_expected') ?? 0,
  }
}

export async function getProjectNames(projectIds: readonly string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map()
  const db = getDb()
  const rows = executeRows(
    await db.execute(sql`
      select id, name from projects
      where id in (${sqlList(projectIds)})
      limit ${projectIds.length}
    `),
  )
  return new Map(rows.map((row) => [String(row.id), String(row.name)]))
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

const federalStateToken = (value: string | null): string | null =>
  value === null ? null : normalizeProfileToken('federal_state', value)

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const dateOrNull = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

const LESSON_STATUSES: readonly string[] = ['candidate', 'active', 'retired']

function lessonStatus(status: unknown, outcome: unknown): FeedbackLessonStatus | null {
  if (typeof status === 'string' && LESSON_STATUSES.includes(status)) return status as PlatformLessonStatus
  return outcome === 'skipped' ? 'skipped' : null
}

function toExportRow(row: Record<string, unknown>): FeedbackExportRow {
  const provenance = sanitizeProvenance(row.provenance) ?? {}
  const jobId = text(row.job_id)
  const answer = typeof row.answer === 'string' ? row.answer : null
  const verdict = row.verdict as AnswerFeedbackVerdict
  const llmCalls = numberOrNull(row.llm_calls)
  return {
    feedbackId: String(row.id),
    organizationId: String(row.organization_id),
    projectId: text(row.project_id),
    projectName: text(row.project_name),
    bundesland: federalStateToken(text(row.bundesland)),
    conversationId: text(row.conversation_id),
    conversationFound: row.conversation_found === true,
    conversationTitle: text(row.conversation_title),
    messageId: String(row.message_id),
    voterKey: String(row.voter_key),
    verdict,
    reason: verdict === 'down' ? ((text(row.reason) as AnswerFeedbackReason | null) ?? 'other') : null,
    comment: text(row.comment),
    expectedAnswer: text(row.expected_answer),
    firstVotedAt: new Date(String(row.created_at)),
    votedAt: new Date(String(row.updated_at)),
    question: typeof row.question === 'string' ? row.question : null,
    answer,
    answeredAt: dateOrNull(row.answered_at),
    topics: Array.isArray(row.topics) ? row.topics.map(String).filter(isConversationTagKey) : [],
    answerMode: jobId ? 'report' : (provenance.routingDecision ?? null),
    answerConfidence: provenance.answerConfidence ?? null,
    confidenceCappedReason: provenance.answerConfidenceCappedReason ?? null,
    sourcesCited: answer === null ? null : numberOrNull(row.sources_cited),
    citationsRemoved: provenance.citationsRemoved?.count ?? null,
    researchTruncated: answer === null ? null : provenance.researchTruncated === true,
    skills: provenance.skillsActivated ?? [],
    clientDurationMs: provenance.answerDurationMs ?? null,
    traceId: isTraceId(row.trace_id) ? row.trace_id : null,
    jobId,
    llmCalls: llmCalls && llmCalls > 0 ? llmCalls : null,
    models: Array.isArray(row.models) ? row.models.map(String).filter(Boolean) : [],
    tokensTotal: llmCalls ? numberOrNull(row.tokens_total) : null,
    costUsd: llmCalls ? numberOrNull(row.cost_usd) : null,
    lessonId: text(row.lesson_id),
    lessonStatus: lessonStatus(row.lesson_status, row.lesson_outcome),
    lessonsHoldout: typeof row.lessons_holdout === 'boolean' ? row.lessons_holdout : null,
  }
}
