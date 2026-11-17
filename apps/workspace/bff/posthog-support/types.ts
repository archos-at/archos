export const SUPPORT_TICKET_STATUSES = ['new', 'open', 'pending', 'on_hold', 'resolved'] as const
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number]

export const FEEDBACK_TICKET_TAG = 'piloti-feedback'

export const NO_CONTACT_TICKET_TAG = 'no-contact'

export const kindTicketTag = (kind: string): string => `kind:${kind}`

export const ACTIVE_SUPPORT_TICKET_STATUSES = ['new', 'open', 'pending', 'on_hold'] as const satisfies readonly SupportTicketStatus[]

export type SupportTicketAssignee =
  | { type: 'user'; id: number; email: string | null }
  | { type: 'role'; id: string; name: string | null }

export function originTicketTag(appOrigin: string | null): string | null {
  if (!appOrigin) return null
  try {
    return `origin:${new URL(appOrigin).host}`
  } catch {
    return null
  }
}

export interface SupportTicket {
  id: string
  ticketNumber: number | null
  status: SupportTicketStatus
  tags: string[]
  createdAt: string
  updatedAt: string
  assignee: SupportTicketAssignee | null
  lastActivityAt: string
  messageCount: number | null
  unreadTeamCount: number
  url: string
}

export interface PosthogMember {
  id: number
  email: string
  name: string | null
}

export interface SupportTicketPage {
  tickets: SupportTicket[]
  count: number
}

export interface PosthogSupportConfig {
  appHost: string
  ingestHost: string
  projectId: string
  projectToken: string
  personalApiKey: string
  appOrigin: string | null
}

export class PosthogSupportUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'PosthogSupportUnavailableError'
  }
}

export interface OpenFeedbackTicketInput {
  message: string
  distinctId: string
  widgetSessionId: string
  sessionId: string | null
  tags: string[]
}

export interface CustomerReplyInput {
  ticketId: string
  widgetSessionId: string
  distinctId: string
  message: string
}

export type SupportMessageAuthor = 'customer' | 'team'

export interface SupportMessage {
  id: string
  author: SupportMessageAuthor
  authorName: string | null
  content: string
  createdAt: string
}
