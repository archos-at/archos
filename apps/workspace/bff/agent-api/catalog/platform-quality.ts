import { z } from 'zod'
import { CONVERSATION_TAG_KEYS } from '@/lib/conversations/tags'
import {
  FEEDBACK_CONFIDENCE_FILTERS,
  FEEDBACK_MODE_FILTERS,
  FEEDBACK_REASON_FILTERS,
} from '@/lib/feedback/filters'
import type { AgentOperation } from '../operation'

const qualityScopeQuery = z.object({
  from: z.string().optional().describe('First day, YYYY-MM-DD, UTC, inclusive. Give `from` and `to` together.'),
  to: z.string().optional().describe('Last day, YYYY-MM-DD, UTC, inclusive. At most 366 days after `from`.'),
  days: z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .optional()
    .describe('A range ending today, used when `from` and `to` are absent. Default 30.'),
  org: z.array(z.string()).optional().describe('Limit to these organization ids; empty means every organization.'),
  project: z.array(z.string()).optional().describe('Limit to these project ids; empty means every project.'),
})

const ratingsQuery = qualityScopeQuery.extend({
  verdict: z.enum(['up', 'down', 'all']).optional().describe('Thumbs filter.'),
  reason: z.array(z.enum(FEEDBACK_REASON_FILTERS)).optional().describe('Down-vote reasons to keep.'),
  topic: z.array(z.enum(CONVERSATION_TAG_KEYS)).optional().describe('Conversation topics to keep.'),
  mode: z.array(z.enum(FEEDBACK_MODE_FILTERS)).optional().describe('Answer modes to keep.'),
  confidence: z.array(z.enum(FEEDBACK_CONFIDENCE_FILTERS)).optional().describe('Answer confidence levels to keep.'),
  has_comment: z.enum(['0', '1']).optional().describe('1 keeps only votes with a comment.'),
  has_expected: z.enum(['0', '1']).optional().describe('1 keeps only votes with an expected answer.'),
  q: z.string().max(120).optional().describe('Free-text search over the vote.'),
})

export const platformQualityOperations = [
  {
    name: 'platform-quality-scope-options',
    domain: 'platform',
    summary: 'List organizations and projects for a quality scope',
    description:
      'The organizations and projects that have data in a date range, for building the `org` and `project` filters of the ' +
      'quality operations (answer feedback, citation health, profiler).',
    method: 'GET',
    path: '/api/platform/quality/scope-options',
    query: qualityScopeQuery,
    load: () => import('@/app/api/platform/quality/scope-options/route'),
  },
  {
    name: 'platform-answer-feedback-get',
    domain: 'platform',
    summary: 'Answer-feedback figures across organizations',
    description:
      'Thumbs up and down on answers over a scope: rates, reasons, topics, modes and the individual ratings, filtered like ' +
      'the Ratings tab. Narrow with platform-quality-scope-options ids; summarize in words with platform-answer-feedback-digest-get.',
    method: 'GET',
    path: '/api/platform/answer-feedback',
    query: ratingsQuery,
    load: () => import('@/app/api/platform/answer-feedback/route'),
  },
  {
    name: 'platform-answer-feedback-digest-get',
    domain: 'platform',
    summary: 'Plain-language digest of answer feedback',
    description:
      'An LLM-written summary of the answer feedback in a scope, cached server-side. A young window may answer with ' +
      '`no_feedback` or `too_few_votes` instead of text. It can be slow; the numbers are in platform-answer-feedback-get.',
    method: 'GET',
    path: '/api/platform/answer-feedback/digest',
    query: ratingsQuery.extend({
      locale: z.string().optional().describe('Language of the digest, de or en. Default de.'),
      refresh: z.literal('1').optional().describe('1 regenerates the digest instead of reading the cache.'),
    }),
    load: () => import('@/app/api/platform/answer-feedback/digest/route'),
  },
  {
    name: 'platform-answer-feedback-options-get',
    domain: 'platform',
    summary: 'Counts behind the answer-feedback filters',
    description:
      'Per-value counts (verdicts, reasons, topics, modes, confidences) and how many votes the current filters would match, ' +
      'to pick filters for platform-answer-feedback-get.',
    method: 'GET',
    path: '/api/platform/answer-feedback/options',
    query: ratingsQuery,
    load: () => import('@/app/api/platform/answer-feedback/options/route'),
  },
  {
    name: 'platform-citation-health-get',
    domain: 'platform',
    summary: 'Citation quality across organizations',
    description:
      'Rollup of citation checks over a scope: how many cited sources held up and why the others failed. ' +
      'For the flagged turns themselves use platform-citation-health-export.',
    method: 'GET',
    path: '/api/platform/citation-health',
    query: qualityScopeQuery,
    load: () => import('@/app/api/platform/citation-health/route'),
  },
  {
    name: 'platform-citation-health-export',
    domain: 'platform',
    summary: 'Diagnostic bundle of flagged citation turns',
    description:
      'A JSON bundle for root-cause analysis: every flagged turn, the sources retrieval returned, the sources the answer cited ' +
      'and which citation failed for which reason, with a glossary. Same scope as platform-citation-health-get; can be large.',
    method: 'GET',
    path: '/api/platform/citation-health/export',
    query: qualityScopeQuery,
    load: () => import('@/app/api/platform/citation-health/export/route'),
  },
  {
    name: 'platform-profiler-conversation-list',
    domain: 'platform',
    summary: 'List profiled conversations',
    description:
      'Conversations with timing profiles across organizations in a scope, optionally searched or narrowed to one. ' +
      'Conversation ids feed platform-profiler-conversation-get.',
    method: 'GET',
    path: '/api/platform/profiler/conversations',
    query: qualityScopeQuery.extend({
      q: z.string().optional().describe('Free-text search over conversations.'),
      conversation: z.string().optional().describe('Narrow to one conversation id.'),
    }),
    load: () => import('@/app/api/platform/profiler/conversations/route'),
  },
  {
    name: 'platform-profiler-conversation-get',
    domain: 'platform',
    summary: 'Timeline of one profiled conversation',
    description:
      'The step-by-step timeline of one conversation: where each turn spent its time. ' +
      'Conversation ids come from platform-profiler-conversation-list.',
    method: 'GET',
    path: '/api/platform/profiler/conversations/[conversationId]',
    params: z.object({
      conversationId: z.string().describe('The conversation id, from platform-profiler-conversation-list.'),
    }),
    load: () => import('@/app/api/platform/profiler/conversations/[conversationId]/route'),
  },
  {
    name: 'platform-answer-feedback-export',
    domain: 'platform',
    summary: 'Export answer feedback as CSV or Excel',
    description:
      'The votes behind platform-answer-feedback-get as a file: `format` csv (default, returned as text) or xlsx (a four-sheet workbook, ' +
      'returned as an attached resource up to 5 MiB). Same scope and filters as the Ratings tab; `scope: "all"` ignores the ratings filters. ' +
      '`summary: "weekly"` exports a CSV per organization and ISO week instead. A cut export says so in its file name.',
    method: 'GET',
    path: '/api/platform/answer-feedback/export',
    query: ratingsQuery.extend({
      format: z.enum(['csv', 'xlsx']).optional().describe('csv (default) or xlsx.'),
      scope: z.enum(['all', 'selection']).optional().describe('all: every vote in the scope, ratings filters ignored.'),
      summary: z.literal('weekly').optional().describe('weekly: a CSV per organization and ISO week instead of the votes.'),
    }),
    binaryResponse: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    load: () => import('@/app/api/platform/answer-feedback/export/route'),
  },
] as const satisfies readonly AgentOperation[]
