import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import { lastVisibleMessageAuthor, listPosthogMembers } from '@/lib/posthog-support/client'
import {
  PosthogSupportUnavailableError,
  type PosthogMember,
  type PosthogSupportConfig,
  type SupportTicket,
} from '@/lib/posthog-support/types'
import type { ProductFeedbackAssigneeView, ProductFeedbackAwaiting, ProductFeedbackTicketView } from './types'

export interface ViewerContext {
  members: readonly PosthogMember[] | null
  viewerEmail: string | null
}

const sameEmail = (a: string | null, b: string | null): boolean =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())

async function membersOrNull(config: PosthogSupportConfig): Promise<PosthogMember[] | null> {
  try {
    return await listPosthogMembers(config)
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn('[product-feedback] PostHog members unreadable; assignees by email:', error.message)
    return null
  }
}

export async function viewerContext(config: PosthogSupportConfig, session: UserSession | null): Promise<ViewerContext> {
  return { members: await membersOrNull(config), viewerEmail: session?.email?.trim() || null }
}

function assigneeView(ticket: SupportTicket, context: ViewerContext): ProductFeedbackAssigneeView | null {
  const { assignee } = ticket
  if (!assignee) return null
  if (assignee.type === 'role') return { type: 'role', name: assignee.name, email: null, isViewer: false }
  const member = context.members?.find((candidate) => candidate.id === assignee.id) ?? null
  const email = assignee.email ?? member?.email ?? null
  return { type: 'user', name: member?.name ?? null, email, isViewer: sameEmail(email, context.viewerEmail) }
}

async function awaitingOf(config: PosthogSupportConfig, ticket: SupportTicket): Promise<ProductFeedbackAwaiting | null> {
  if (ticket.status === 'resolved') return null
  try {
    const author = await lastVisibleMessageAuthor(config, ticket)
    if (author === 'customer') return 'team'
    if (author === 'team') return 'reporter'
    return null
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    return null
  }
}

const THREAD_READ_CONCURRENCY = 8

async function inBatches<T, R>(items: readonly T[], size: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map(map))))
  }
  return out
}

export async function ticketViews(
  config: PosthogSupportConfig,
  tickets: readonly SupportTicket[],
  context: ViewerContext
): Promise<Map<string, ProductFeedbackTicketView>> {
  const awaiting = await inBatches(tickets, THREAD_READ_CONCURRENCY, (ticket) => awaitingOf(config, ticket))
  return new Map(
    tickets.map((ticket, index) => [
      ticket.id,
      {
        id: ticket.id,
        number: ticket.ticketNumber,
        status: ticket.status,
        url: ticket.url,
        assignee: assigneeView(ticket, context),
        lastActivityAt: ticket.lastActivityAt,
        awaiting: awaiting[index] ?? null,
      },
    ])
  )
}

export async function oneTicketView(
  config: PosthogSupportConfig,
  ticket: SupportTicket | null,
  session: UserSession | null
): Promise<ProductFeedbackTicketView | null> {
  if (!ticket) return null
  const views = await ticketViews(config, [ticket], await viewerContext(config, session))
  return views.get(ticket.id) ?? null
}
