import type { Dictionary as FullDictionary } from '@/i18n/dictionaries'
import { interpolate } from '@/i18n/translate'
import { CONVERSATION_TAG_KEYS } from '@/lib/conversations/tags'
import type { FeedbackExportRow } from './export-repository'
import type { FeedbackWeeklyCount } from './repository'
import { MIN_TREND_VOTES } from './trend'

export type Dictionary = Pick<FullDictionary, 'feedbackExport' | 'platform'>

export type ExportFormat = keyof Dictionary['feedbackExport']['formats']

export type ExportCell = string | number | boolean | Date | readonly string[] | null

export interface ExportColumn<Row> {
  key: string
  format: ExportFormat
  source: string
  width: number
  wrap?: boolean
  label: (dictionary: Dictionary) => string
  description: (dictionary: Dictionary) => string
  value: (row: Row, dictionary: Dictionary) => ExportCell
}

export interface FeedbackExportRecord extends FeedbackExportRow {
  organizationName: string | null
  appUrl: string | null
  langfuseTraceUrl: string | null
}

export interface FeedbackWeeklyRecord extends FeedbackWeeklyCount {
  organizationName: string | null
}

type VoteColumnKey = keyof Dictionary['feedbackExport']['columns']
type WeekColumnKey = keyof Dictionary['feedbackExport']['weeklyColumns']

interface ColumnSpec<Row> {
  format: ExportFormat
  source: string
  width: number
  wrap?: boolean
  value: (row: Row, dictionary: Dictionary) => ExportCell
}

function voteColumn(key: VoteColumnKey, spec: ColumnSpec<FeedbackExportRecord>): ExportColumn<FeedbackExportRecord> {
  return {
    key,
    ...spec,
    label: (dictionary) => dictionary.feedbackExport.columns[key].label,
    description: (dictionary) => dictionary.feedbackExport.columns[key].description,
  }
}

function weekColumn(key: WeekColumnKey, spec: ColumnSpec<FeedbackWeeklyRecord>): ExportColumn<FeedbackWeeklyRecord> {
  return {
    key,
    ...spec,
    label: (dictionary) => dictionary.feedbackExport.weeklyColumns[key].label,
    description: (dictionary) => dictionary.feedbackExport.weeklyColumns[key].description,
  }
}

const VOTE_CHANGED_AFTER_MS = 1000

export function utcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()))
}

export function isoWeekLabel(instant: Date): string {
  const day = utcDay(instant)
  const weekday = (day.getUTCDay() + 6) % 7 // Monday = 0
  const thursday = new Date(day.getTime() + (3 - weekday) * 86_400_000)
  const isoYear = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7
  const week1Monday = firstThursday.getTime() - firstWeekday * 86_400_000
  const week = Math.floor((thursday.getTime() - week1Monday) / (7 * 86_400_000)) + 1
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

const topicLabel = (dictionary: Dictionary, topic: string): string =>
  (dictionary.platform.answerFeedback.topics as Record<string, string>)[topic] ?? topic

const TOPIC_COLUMNS: ExportColumn<FeedbackExportRecord>[] = CONVERSATION_TAG_KEYS.map((topic) => ({
  key: `topic_${topic}`,
  format: 'boolean',
  source: 'conversations.tags',
  width: 10,
  label: (dictionary) => interpolate(dictionary.feedbackExport.topicColumn.label, { topic: topicLabel(dictionary, topic) }),
  description: (dictionary) =>
    interpolate(dictionary.feedbackExport.topicColumn.description, { topic: topicLabel(dictionary, topic) }),
  value: (row) => row.topics.includes(topic),
}))

export const FEEDBACK_EXPORT_COLUMNS: readonly ExportColumn<FeedbackExportRecord>[] = [
  voteColumn('feedback_id', { format: 'id', source: 'answer_feedback.id', width: 38, value: (r) => r.feedbackId }),
  voteColumn('voted_at', { format: 'datetime', source: 'answer_feedback.updated_at', width: 20, value: (r) => r.votedAt }),
  voteColumn('first_voted_at', {
    format: 'datetime',
    source: 'answer_feedback.created_at',
    width: 20,
    value: (r) => r.firstVotedAt,
  }),
  voteColumn('vote_changed', {
    format: 'boolean',
    source: 'answer_feedback.updated_at > created_at + 1 s',
    width: 10,
    value: (r) => r.votedAt.getTime() - r.firstVotedAt.getTime() > VOTE_CHANGED_AFTER_MS,
  }),
  voteColumn('vote_date', {
    format: 'date',
    source: 'answer_feedback.created_at (UTC day)',
    width: 12,
    value: (r) => utcDay(r.firstVotedAt),
  }),
  voteColumn('iso_week', {
    format: 'week',
    source: 'answer_feedback.created_at (ISO week, UTC)',
    width: 10,
    value: (r) => isoWeekLabel(r.firstVotedAt),
  }),
  voteColumn('verdict', { format: 'text', source: 'answer_feedback.verdict', width: 8, value: (r) => r.verdict }),
  voteColumn('helpful', {
    format: 'boolean',
    source: "answer_feedback.verdict = 'up'",
    width: 9,
    value: (r) => r.verdict === 'up',
  }),
  voteColumn('reason', {
    format: 'text',
    source: "answer_feedback.reason (NULL on a down-vote = 'other')",
    width: 13,
    value: (r) => r.reason,
  }),
  voteColumn('reason_label', {
    format: 'text',
    source: 'answer_feedback.reason, labelled',
    width: 16,
    value: (r, d) => (r.reason ? d.platform.answerFeedback.reasons[r.reason] : null),
  }),
  voteColumn('organization_name', {
    format: 'text',
    source: 'organizations / WorkOS display name',
    width: 24,
    value: (r) => r.organizationName,
  }),
  voteColumn('organization_id', {
    format: 'id',
    source: 'answer_feedback.organization_id',
    width: 30,
    value: (r) => r.organizationId,
  }),
  voteColumn('project_name', { format: 'text', source: 'projects.name', width: 24, value: (r) => r.projectName }),
  voteColumn('project_id', {
    format: 'id',
    source: 'answer_feedback.project_id, else conversations.project_id',
    width: 38,
    value: (r) => r.projectId,
  }),
  voteColumn('bundesland', {
    format: 'text',
    source: "projects.profile -> facts.federal_state.value",
    width: 14,
    value: (r) => r.bundesland,
  }),
  voteColumn('conversation_title', {
    format: 'text',
    source: 'conversations.title',
    width: 30,
    wrap: true,
    value: (r) => r.conversationTitle,
  }),
  voteColumn('conversation_id', {
    format: 'id',
    source: 'messages.conversation_id, else answer_feedback.conversation_id',
    width: 30,
    value: (r) => r.conversationId,
  }),
  voteColumn('message_id', { format: 'id', source: 'answer_feedback.message_id', width: 38, value: (r) => r.messageId }),
  voteColumn('voter_key', {
    format: 'id',
    source: "sha256(organization_id || ':' || user_id), first 12 hex",
    width: 14,
    value: (r) => r.voterKey,
  }),
  voteColumn('topics', { format: 'list', source: 'conversations.tags', width: 22, value: (r) => r.topics }),
  ...TOPIC_COLUMNS,
  voteColumn('question', {
    format: 'text',
    source: 'messages.content (the user message before the answer)',
    width: 50,
    wrap: true,
    value: (r) => r.question,
  }),
  voteColumn('answer', {
    format: 'text',
    source: 'messages.content (the rated answer)',
    width: 70,
    wrap: true,
    value: (r) => r.answer,
  }),
  voteColumn('comment', { format: 'text', source: 'answer_feedback.comment', width: 40, wrap: true, value: (r) => r.comment }),
  voteColumn('expected_answer', {
    format: 'text',
    source: 'answer_feedback.expected_answer',
    width: 40,
    wrap: true,
    value: (r) => r.expectedAnswer,
  }),
  voteColumn('answer_chars', {
    format: 'integer',
    source: 'length(messages.content)',
    width: 10,
    value: (r) => (r.answer === null ? null : r.answer.length),
  }),
  voteColumn('answer_mode', {
    format: 'text',
    source: "messages.metadata.provenance.routingDecision; 'report' with a job id",
    width: 10,
    value: (r) => r.answerMode,
  }),
  voteColumn('answer_confidence', {
    format: 'text',
    source: 'messages.metadata.provenance.answerConfidence',
    width: 10,
    value: (r) => r.answerConfidence,
  }),
  voteColumn('confidence_capped_reason', {
    format: 'text',
    source: 'messages.metadata.provenance.answerConfidenceCappedReason',
    width: 18,
    value: (r) => r.confidenceCappedReason,
  }),
  voteColumn('sources_cited', {
    format: 'integer',
    source: 'messages.metadata.citations.sources (cited)',
    width: 9,
    value: (r) => r.sourcesCited,
  }),
  voteColumn('citations_removed', {
    format: 'integer',
    source: 'messages.metadata.provenance.citationsRemoved.count',
    width: 9,
    value: (r) => r.citationsRemoved,
  }),
  voteColumn('research_truncated', {
    format: 'boolean',
    source: 'messages.metadata.provenance.researchTruncated',
    width: 10,
    value: (r) => r.researchTruncated,
  }),
  voteColumn('skills', {
    format: 'list',
    source: 'messages.metadata.provenance.skillsActivated',
    width: 20,
    value: (r) => r.skills,
  }),
  voteColumn('answered_at', { format: 'datetime', source: 'messages.created_at', width: 20, value: (r) => r.answeredAt }),
  voteColumn('client_duration_s', {
    format: 'seconds',
    source: 'messages.metadata.provenance.answerDurationMs / 1000 (browser)',
    width: 10,
    value: (r) => (r.clientDurationMs === null ? null : r.clientDurationMs / 1000),
  }),
  voteColumn('llm_calls', {
    format: 'integer',
    source: 'llm_usage_events (count)',
    width: 9,
    value: (r) => r.llmCalls,
  }),
  voteColumn('models', {
    format: 'list',
    source: 'llm_usage_events.model (distinct)',
    width: 26,
    value: (r) => r.models,
  }),
  voteColumn('tokens_total', {
    format: 'integer',
    source: 'llm_usage_events.total_tokens (sum)',
    width: 10,
    value: (r) => r.tokensTotal,
  }),
  voteColumn('cost_usd', { format: 'usd', source: 'llm_usage_events.cost_usd (sum)', width: 10, value: (r) => r.costUsd }),
  voteColumn('lesson_id', { format: 'id', source: 'platform_lesson_reports.lesson_id', width: 38, value: (r) => r.lessonId }),
  voteColumn('lesson_status', {
    format: 'text',
    source: "platform_lessons.status; 'skipped' from platform_lesson_reports.outcome",
    width: 11,
    value: (r) => r.lessonStatus,
  }),
  voteColumn('lessons_holdout', {
    format: 'boolean',
    source: 'answer_feedback.lessons_holdout',
    width: 10,
    value: (r) => r.lessonsHoldout,
  }),
  voteColumn('app_url', { format: 'url', source: 'app origin + conversation deep link', width: 16, value: (r) => r.appUrl }),
  voteColumn('langfuse_trace_url', {
    format: 'url',
    source: 'LANGFUSE_PUBLIC_URL + project + trace id',
    width: 16,
    value: (r) => r.langfuseTraceUrl,
  }),
  voteColumn('trace_id', { format: 'id', source: "messages.metadata.trace_id", width: 34, value: (r) => r.traceId }),
]

export function helpfulRate(up: number, down: number): number | null {
  const votes = up + down
  return votes >= MIN_TREND_VOTES ? up / votes : null
}

export const FEEDBACK_WEEKLY_COLUMNS: readonly ExportColumn<FeedbackWeeklyRecord>[] = [
  weekColumn('organization_name', {
    format: 'text',
    source: 'organizations / WorkOS display name',
    width: 24,
    value: (w) => w.organizationName,
  }),
  weekColumn('organization_id', { format: 'id', source: 'organization_id', width: 30, value: (w) => w.organizationId }),
  weekColumn('iso_week', { format: 'week', source: 'ISO week, UTC', width: 10, value: (w) => w.isoWeek }),
  weekColumn('week_start', {
    format: 'date',
    source: 'Monday of the ISO week, UTC',
    width: 12,
    value: (w) => new Date(`${w.weekStart}T00:00:00.000Z`),
  }),
  weekColumn('answers', {
    format: 'integer',
    source: 'messages (assistant, produced) ∪ answer_feedback.message_id (rated)',
    width: 10,
    value: (w) => w.answers,
  }),
  weekColumn('rated_answers', {
    format: 'integer',
    source: 'answer_feedback.message_id (distinct)',
    width: 10,
    value: (w) => w.ratedAnswers,
  }),
  weekColumn('up', { format: 'integer', source: "answer_feedback (verdict 'up')", width: 9, value: (w) => w.up }),
  weekColumn('down', { format: 'integer', source: "answer_feedback (verdict 'down')", width: 9, value: (w) => w.down }),
  weekColumn('helpful_rate', {
    format: 'percent',
    source: `up / (up + down), blank under ${MIN_TREND_VOTES} votes`,
    width: 10,
    value: (w) => helpfulRate(w.up, w.down),
  }),
  weekColumn('coverage', {
    format: 'percent',
    source: 'rated_answers / answers',
    width: 10,
    value: (w) => (w.answers > 0 ? w.ratedAnswers / w.answers : null),
  }),
]
