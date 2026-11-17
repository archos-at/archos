import 'server-only'
import { UpstreamError } from '@/lib/api/errors'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, type InboxEmission } from '@/lib/inbox/service'
import { listCustomerVisibleMessages } from '@/lib/posthog-support/client'
import { posthogSupportConfigFromEnv } from '@/lib/posthog-support/config'
import { PosthogSupportUnavailableError, type SupportMessage } from '@/lib/posthog-support/types'
import {
  advanceReporterNotifiedAt,
  findProductFeedbackByTicketId,
  rewindReporterNotifiedAt,
} from './repository'

export const FEEDBACK_REPLY_INBOX_TYPE = 'feedback.replied' as const

const SUBJECT_MAX = 80
const EXCERPT_MAX = 500

export type FeedbackReplyNotice =
  | { status: 'not-configured' }
  | { status: 'unknown-ticket' }
  | { status: 'nothing-new' }
  | { status: 'notified'; replies: number }

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const timeOf = (message: SupportMessage): number => new Date(message.createdAt).getTime()

export function unannouncedReplies(
  report: Pick<ProductFeedback, 'createdAt' | 'reporterSeenAt' | 'reporterNotifiedAt'>,
  messages: readonly SupportMessage[]
): SupportMessage[] {
  const since = Math.max(
    new Date(report.createdAt).getTime(),
    report.reporterSeenAt ? new Date(report.reporterSeenAt).getTime() : 0,
    report.reporterNotifiedAt ? new Date(report.reporterNotifiedAt).getTime() : 0
  )
  return messages
    .filter((message) => message.author === 'team' && Number.isFinite(timeOf(message)) && timeOf(message) > since)
    .sort((a, b) => timeOf(a) - timeOf(b))
}

export function replyEmission(
  report: Pick<ProductFeedback, 'id' | 'organizationId' | 'userId' | 'kind' | 'message'>,
  replies: readonly SupportMessage[]
): InboxEmission {
  const latest = replies.at(-1)
  return {
    organizationId: report.organizationId,
    recipientUserId: report.userId,
    type: FEEDBACK_REPLY_INBOX_TYPE,
    resourceType: 'product_feedback',
    resourceId: report.id,
    groupKey: inboxGroupKey(FEEDBACK_REPLY_INBOX_TYPE, 'product_feedback', report.id),
    occurrences: replies.length,
    payload: {
      subject: clip(report.message, SUBJECT_MAX),
      excerpt: latest ? clip(latest.content, EXCERPT_MAX) : undefined,
      related: latest?.authorName ?? undefined,
      kind: report.kind,
    },
  }
}

async function reportForTicket(ticketId: string): Promise<ProductFeedback | null> {
  return withPlatformAccess('product feedback: find the report a PostHog poke names', () =>
    findProductFeedbackByTicketId(ticketId)
  )
}

export async function notifyFeedbackReplies(ticketId: string): Promise<FeedbackReplyNotice> {
  const config = posthogSupportConfigFromEnv(process.env)
  if (!config) return { status: 'not-configured' }

  const report = await reportForTicket(ticketId)
  if (!report) return { status: 'unknown-ticket' }

  let messages: SupportMessage[]
  try {
    messages = await listCustomerVisibleMessages(config, ticketId)
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn(`[product-feedback] reply poke for report ${report.id}: thread unreadable:`, error.message)
    throw new UpstreamError('PostHog Support could not be read.')
  }

  const replies = unannouncedReplies(report, messages)
  const latest = replies.at(-1)
  if (!latest) return { status: 'nothing-new' }

  const newest = new Date(latest.createdAt)
  return withTenant({ organizationId: report.organizationId }, async () => {
    if (!(await advanceReporterNotifiedAt(report.organizationId, report.id, newest))) {
      return { status: 'nothing-new' } as const
    }
    try {
      await emitInboxItems([replyEmission(report, replies)])
    } catch (error) {
      await rewindReporterNotifiedAt(report.organizationId, report.id, newest, report.reporterNotifiedAt).catch(
        () => undefined
      )
      throw error
    }
    return { status: 'notified', replies: replies.length } as const
  })
}
