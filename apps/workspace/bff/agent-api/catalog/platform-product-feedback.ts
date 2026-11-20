import { z } from 'zod'
import {
  claimProductFeedbackSchema,
  listProductFeedbackQuerySchema,
  triageProductFeedbackSchema,
} from '@/lib/product-feedback/types'
import type { AgentOperation } from '../operation'

const reportParams = z.object({
  reportId: z.string().describe('The product-feedback report id (a uuid), from platform-feedback-list.'),
})

export const platformProductFeedbackOperations = [
  {
    name: 'platform-feedback-list',
    domain: 'platform',
    summary: 'List product-feedback reports',
    description:
      'Product-feedback reports from every organization with their PostHog Support ticket: status, assignee, last activity ' +
      'and whether the team or the reporter owes the next answer. Filter by ticket status (`active` for every unresolved ' +
      'ticket), assignee (`mine`, `unassigned`) and kind, and page with the returned `nextCursor`. Report ids feed ' +
      'platform-feedback-get and platform-feedback-triage; ticket ids feed platform-feedback-claim.',
    method: 'GET',
    path: '/api/platform/feedback',
    query: listProductFeedbackQuerySchema,
    load: () => import('@/app/api/platform/feedback/route'),
  },
  {
    name: 'platform-feedback-get',
    domain: 'platform',
    summary: 'Read one product-feedback report',
    description: 'One report and its live PostHog ticket. Report ids come from platform-feedback-list.',
    method: 'GET',
    path: '/api/platform/feedback/[reportId]',
    params: reportParams,
    load: () => import('@/app/api/platform/feedback/[reportId]/route'),
  },
  {
    name: 'platform-feedback-triage',
    domain: 'platform',
    summary: 'Move a feedback ticket to another status',
    description:
      'Sets the PostHog Support ticket status of a report; PostHog records who did it. Report ids come from ' +
      'platform-feedback-list; valid statuses are those it filters by.',
    method: 'PATCH',
    path: '/api/platform/feedback/[reportId]',
    params: reportParams,
    body: triageProductFeedbackSchema,
    idempotent: true,
    load: () => import('@/app/api/platform/feedback/[reportId]/route'),
  },
  {
    name: 'platform-feedback-claim',
    domain: 'platform',
    summary: 'Take a feedback ticket',
    description:
      'Assigns a report’s PostHog Support ticket to the person, found in PostHog by their email. Takes the ticket id (the ' +
      'Slack alert carries it; platform-feedback-list returns it as `ticket.id`). Returns the report.',
    method: 'POST',
    path: '/api/platform/feedback/claim',
    body: claimProductFeedbackSchema,
    idempotent: true,
    load: () => import('@/app/api/platform/feedback/claim/route'),
  },
] as const satisfies readonly AgentOperation[]
