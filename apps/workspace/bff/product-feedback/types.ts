import { z } from 'zod'
import {
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_MESSAGE_MAX,
  PRODUCT_FEEDBACK_PAGE_MAX,
  type ProductFeedbackContext,
  type ProductFeedbackKind,
} from '@/lib/db/schema/product-feedback'
import {
  ACTIVE_SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketStatus,
} from '@/lib/posthog-support/types'

export {
  ACTIVE_SUPPORT_TICKET_STATUSES,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_MESSAGE_MAX,
  PRODUCT_FEEDBACK_PAGE_MAX,
  SUPPORT_TICKET_STATUSES,
}
export type { ProductFeedbackContext, ProductFeedbackKind, SupportTicketStatus }

export const PRODUCT_FEEDBACK_MESSAGE_MIN = 10

const contextString = (max: number) => z.string().trim().max(max).optional()

const pagePathSchema = z
  .string()
  .trim()
  .max(PRODUCT_FEEDBACK_PAGE_MAX)
  .nullish()
  .transform((value) => (value && /^\/[^\s?#]*$/.test(value) ? value : null))

const posthogBrowserId = z
  .string()
  .max(64)
  .nullish()
  .transform((value) => (value && /^[0-9a-f-]{8,64}$/i.test(value) ? value : null))

export const submitProductFeedbackSchema = z.object({
  kind: z.enum(PRODUCT_FEEDBACK_KINDS),
  message: z.string().trim().min(PRODUCT_FEEDBACK_MESSAGE_MIN).max(PRODUCT_FEEDBACK_MESSAGE_MAX),
  pagePath: pagePathSchema,
  allowContact: z.boolean().default(true),
  context: z
    .object({
      userAgent: contextString(500),
      viewport: contextString(40),
      locale: contextString(40),
      timeZone: contextString(80),
      appVersion: contextString(80),
    })
    .strip()
    .default({}),
  posthog: z
    .object({ sessionId: posthogBrowserId })
    .strip()
    .nullish()
    .transform((value) => value ?? { sessionId: null }),
})

export type SubmitProductFeedbackInput = z.infer<typeof submitProductFeedbackSchema>

export interface SubmittedProductFeedbackView {
  id: string
  kind: ProductFeedbackKind
  createdAt: string
}

export const PLATFORM_FEEDBACK_PAGE_MAX = 50

export const PRODUCT_FEEDBACK_STATUS_FILTERS = [...SUPPORT_TICKET_STATUSES, 'active'] as const
export type ProductFeedbackStatusFilter = (typeof PRODUCT_FEEDBACK_STATUS_FILTERS)[number]

export const PRODUCT_FEEDBACK_ASSIGNEE_FILTERS = ['mine', 'unassigned'] as const
export type ProductFeedbackAssigneeFilter = (typeof PRODUCT_FEEDBACK_ASSIGNEE_FILTERS)[number]

export const listProductFeedbackQuerySchema = z.object({
  status: z
    .enum(PRODUCT_FEEDBACK_STATUS_FILTERS)
    .optional()
    .describe('A PostHog ticket status, or `active` for every ticket that is not resolved. Absent lists every status.'),
  kind: z.enum(PRODUCT_FEEDBACK_KINDS).optional(),
  assignee: z
    .enum(PRODUCT_FEEDBACK_ASSIGNEE_FILTERS)
    .optional()
    .describe('`mine`: tickets assigned to the person. `unassigned`: tickets nobody has. Absent lists everyone’s.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PLATFORM_FEEDBACK_PAGE_MAX)
    .optional()
    .describe(`Reports per page (1 to ${PLATFORM_FEEDBACK_PAGE_MAX}, the default).`),
  cursor: z.string().max(200).optional().describe('`nextCursor` of the previous page.'),
})

export type ListProductFeedbackQuery = z.infer<typeof listProductFeedbackQuerySchema>

export const triageProductFeedbackSchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES),
})

export const claimProductFeedbackSchema = z.object({
  ticketId: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .describe('The PostHog Support ticket id (a UUID), as the Slack alert or platform-feedback-list names it.'),
})

export interface ProductFeedbackAssigneeView {
  type: 'user' | 'role'
  name: string | null
  email: string | null
  isViewer: boolean
}

export type ProductFeedbackAwaiting = 'team' | 'reporter'

export interface ProductFeedbackTicketView {
  id: string
  number: number | null
  status: SupportTicketStatus
  url: string
  assignee: ProductFeedbackAssigneeView | null
  lastActivityAt: string
  awaiting: ProductFeedbackAwaiting | null
}

export interface ProductFeedbackReportView {
  id: string
  kind: ProductFeedbackKind
  ticket: ProductFeedbackTicketView | null
  posthogPersonUrl: string | null
  message: string
  pagePath: string | null
  context: ProductFeedbackContext
  allowContact: boolean
  organizationId: string
  organizationName: string | null
  reporter: { userId: string; name: string | null; email: string | null }
  createdAt: string
  updatedAt: string
}

export interface ProductFeedbackListResponse {
  source: 'posthog' | 'local'
  reports: ProductFeedbackReportView[]
  counts: Record<SupportTicketStatus, number> | null
  unticketed: ProductFeedbackReportView[]
  nextCursor: string | null
  viewerNotInPosthog: boolean
}

export const replyToProductFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(PRODUCT_FEEDBACK_MESSAGE_MAX),
})

export type ReplyToProductFeedbackInput = z.infer<typeof replyToProductFeedbackSchema>

export const listOwnProductFeedbackQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(20).describe('Reports per page, newest first (1 to 20).'),
  cursor: z.string().max(200).optional().describe('`nextCursor` of the previous page.'),
})

export type ListOwnProductFeedbackQuery = z.infer<typeof listOwnProductFeedbackQuerySchema>

export const listOfficeProductFeedbackQuerySchema = listOwnProductFeedbackQuerySchema

export type ListOfficeProductFeedbackQuery = ListOwnProductFeedbackQuery

export function isActiveFeedbackCase(status: SupportTicketStatus | null): boolean {
  return status !== 'resolved'
}

export interface OwnProductFeedbackSummary {
  id: string
  kind: ProductFeedbackKind
  excerpt: string
  createdAt: string
  status: SupportTicketStatus | null
  ticketNumber: number | null
  lastActivityAt: string
  hasUpdate: boolean
  canReply: boolean
  mine: boolean
  reporterName: string | null
}

export interface OwnProductFeedbackListResponse {
  reports: OwnProductFeedbackSummary[]
  updatedCount: number
  live: boolean
  nextCursor: string | null
  canViewOffice: boolean
}

export interface OwnProductFeedbackMessage {
  id: string
  author: 'reporter' | 'team'
  authorName: string | null
  content: string
  createdAt: string
}

export interface OwnProductFeedbackThread {
  report: OwnProductFeedbackSummary
  messages: OwnProductFeedbackMessage[]
  live: boolean
}

export const FEEDBACK_THREAD_PARAM = 'feedback'

export function feedbackThreadHref(reportId: string): string {
  return `/app/projects?${FEEDBACK_THREAD_PARAM}=${encodeURIComponent(reportId)}`
}

export const posthogSupportPokeSchema = z.object({
  ticketId: z.string().trim().guid(),
})
export type PosthogSupportPoke = z.infer<typeof posthogSupportPokeSchema>
