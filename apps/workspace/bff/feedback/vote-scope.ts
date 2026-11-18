import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { sqlList } from '@/lib/db/sql-list'
import { scopeBounds } from '@/lib/quality/scope'
import { likeContains } from '@/lib/text/like-pattern'
import type { FeedbackQuery } from './filters'
import { answerIdOf, VOTED_ANSWER_JOIN, VOTED_QUESTION_JOIN } from './turn-join'

export { sqlList }

export const VOTE_PROJECT = sql`coalesce(f.project_id, c.project_id)`

export const ANSWER_JOB_ID = sql`nullif(coalesce(m.metadata->'provenance'->>'deepResearchJobId', tr.backend_job_id), '')`

export const ANSWER_MODE = sql`(case when ${ANSWER_JOB_ID} is not null then 'report' else m.metadata->'provenance'->>'routingDecision' end)`

export const ANSWER_CONFIDENCE = sql`(m.metadata->'provenance'->>'answerConfidence')`

const hasText = (column: SQL): SQL => sql`nullif(btrim(${column}), '') is not null`

export const OUTSIDE_RESTRICTED_USE = sql`not feedback_restricted_use(f.organization_id, f.message_id, f.conversation_id)`

export interface VoteScopeOptions {
  question?: boolean
  scopeOnly?: boolean
  extraJoins?: SQL
  contentBearing?: boolean
}

export function voteScope(query: FeedbackQuery, options: VoteScopeOptions = {}): SQL {
  const { scope } = query
  const ratings = options.scopeOnly ? null : query.ratings
  const { start, endExclusive } = scopeBounds(scope)
  const withQuestion = options.question || Boolean(ratings?.query)
  const conditions: SQL[] = [
    sql`f.created_at >= ${start.toISOString()}::timestamptz`,
    sql`f.created_at < ${endExclusive.toISOString()}::timestamptz`,
  ]
  if (scope.organizationIds.length) conditions.push(sql`f.organization_id in (${sqlList(scope.organizationIds)})`)
  if (scope.projectIds.length) conditions.push(sql`${VOTE_PROJECT} in (${sqlList(scope.projectIds)})`)
  if (ratings) conditions.push(...ratingsConditions(ratings))
  if (options.contentBearing) conditions.push(OUTSIDE_RESTRICTED_USE)

  return sql`
    from answer_feedback f
    ${VOTED_ANSWER_JOIN}
    ${withQuestion ? VOTED_QUESTION_JOIN : sql``}
    left join conversations c
      on c.id = coalesce(m.conversation_id, f.conversation_id)
     and c.organization_id = f.organization_id
    left join task_runs tr
      on tr.id = ${answerIdOf(sql`m.run_id`)}
     and tr.organization_id = m.organization_id
    ${options.extraJoins ?? sql``}
    where ${sql.join(conditions, sql` and `)}
  `
}

function ratingsConditions(ratings: FeedbackQuery['ratings']): SQL[] {
  const conditions: SQL[] = []
  if (ratings.verdict) conditions.push(sql`f.verdict = ${ratings.verdict}`)
  if (ratings.reasons.length) {
    conditions.push(sql`f.verdict = 'down'`)
    conditions.push(sql`coalesce(f.reason, 'other') in (${sqlList(ratings.reasons)})`)
  }
  if (ratings.topics.length) conditions.push(sql`c.tags && array[${sqlList(ratings.topics)}]::text[]`)
  if (ratings.modes.length) conditions.push(sql`${ANSWER_MODE} in (${sqlList(ratings.modes)})`)
  if (ratings.confidences.length) conditions.push(sql`${ANSWER_CONFIDENCE} in (${sqlList(ratings.confidences)})`)
  if (ratings.hasComment) conditions.push(hasText(sql`f.comment`))
  if (ratings.hasExpectedAnswer) conditions.push(hasText(sql`f.expected_answer`))
  if (ratings.query) {
    const pattern = likeContains(ratings.query)
    conditions.push(sql`(m.content ilike ${pattern} or q.content ilike ${pattern})`)
  }
  return conditions
}
