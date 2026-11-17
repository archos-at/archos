import 'server-only'
import { randomUUID } from 'node:crypto'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { authorize, can } from '@/lib/authz/decide'
import { ORG_PERMISSIONS, PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { requirePlatformPermission } from '@/lib/authz/platform'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { captureServer } from '@/lib/analytics/posthog-server'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import {
  assignSupportTicket,
  countFeedbackTicketsByStatus,
  findPosthogUserIdByEmail,
  getSupportTicket,
  lastVisibleMessageAuthor,
  listCustomerVisibleMessages,
  listFeedbackTickets,
  listFeedbackTicketsOf,
  listPosthogMembers,
  memberByEmail,
  openFeedbackTicket,
  replyAsCustomer,
  updateSupportTicketStatus,
  type SupportTicketAssigneeFilter,
} from '@/lib/posthog-support/client'
import { posthogSupportConfigFromEnv } from '@/lib/posthog-support/config'
import {
  ACTIVE_SUPPORT_TICKET_STATUSES,
  FEEDBACK_TICKET_TAG,
  kindTicketTag,
  NO_CONTACT_TICKET_TAG,
  originTicketTag,
  PosthogSupportUnavailableError,
  SUPPORT_TICKET_STATUSES,
  type PosthogMember,
  type PosthogSupportConfig,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/lib/posthog-support/types'
import { maskChatText } from '@/lib/upload-screening/service'
import { announceProductFeedback } from './announce'
import {
  getOrganizationProductFeedback,
  getOwnProductFeedback,
  getProductFeedback,
  getProductFeedbackByTicketIds,
  insertProductFeedback,
  listOrganizationProductFeedback,
  listOwnProductFeedback,
  listProductFeedback,
  markOwnProductFeedbackSeen,
  OWN_PRODUCT_FEEDBACK_LIMIT,
  PRODUCT_FEEDBACK_LIST_LIMIT,
  setProductFeedbackTicket,
  type ProductFeedbackRow,
} from './repository'
import type {
  ListOfficeProductFeedbackQuery,
  ListOwnProductFeedbackQuery,
  ListProductFeedbackQuery,
  OwnProductFeedbackListResponse,
  OwnProductFeedbackMessage,
  OwnProductFeedbackSummary,
  OwnProductFeedbackThread,
  ProductFeedbackAssigneeView,
  ProductFeedbackAwaiting,
  ProductFeedbackKind,
  ProductFeedbackListResponse,
  ProductFeedbackReportView,
  ProductFeedbackTicketView,
  SubmitProductFeedbackInput,
  SubmittedProductFeedbackView,
} from './types'

const UNTICKETED_WINDOW_DAYS = 30

const supportConfig = (): PosthogSupportConfig | null => posthogSupportConfigFromEnv(process.env)

export function supportTicketText(
  kind: ProductFeedbackKind,
  reportId: string,
  pagePath: string | null,
  maskedText: string
): string {
  return `[${kind}] #${reportId}${pagePath ? ` ${pagePath}` : ''}\n${maskedText}`
}

function announceToSupport(
  event: 'product_feedback_ticket_opened' | 'product_feedback_reply_sent',
  session: AuthorizedSession,
  report: ProductFeedback,
  ticketId: string
): void {
  captureServer({
    event,
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: {
      ticket_id: ticketId,
      report_id: report.id,
      kind: report.kind,
      allow_contact: report.allowContact,
    },
  })
}

export function ticketTagsFor(
  report: Pick<ProductFeedback, 'kind' | 'allowContact'>,
  config: Pick<PosthogSupportConfig, 'appOrigin'>
): string[] {
  const origin = originTicketTag(config.appOrigin)
  return [
    FEEDBACK_TICKET_TAG,
    kindTicketTag(report.kind),
    ...(report.allowContact ? [] : [NO_CONTACT_TICKET_TAG]),
    ...(origin ? [origin] : []),
  ]
}

async function openTicketFor(
  session: AuthorizedSession,
  report: ProductFeedback,
  input: SubmitProductFeedbackInput,
  config: PosthogSupportConfig
): Promise<void> {
  try {
    const masked = (await maskChatText(session.organizationId, input.message)).text
    const widgetSessionId = randomUUID()
    const ticketId = await openFeedbackTicket(config, {
      message: supportTicketText(report.kind, report.id, report.pagePath, masked),
      distinctId: session.userId,
      widgetSessionId,
      sessionId: input.posthog.sessionId,
      tags: ticketTagsFor(report, config),
    })
    await setProductFeedbackTicket(report.id, ticketId, widgetSessionId)
    announceToSupport('product_feedback_ticket_opened', session, report, ticketId)
  } catch (error) {
    console.error(`[product-feedback] report ${report.id} stored, but no Support ticket opened:`, error)
  }
}

export async function submitProductFeedback(
  session: AuthorizedSession,
  input: SubmitProductFeedbackInput
): Promise<SubmittedProductFeedbackView> {
  const report = await insertProductFeedback({
    organizationId: session.organizationId,
    userId: session.userId,
    userName: session.name,
    userEmail: session.email || null,
    kind: input.kind,
    message: input.message,
    pagePath: input.pagePath ?? null,
    context: input.context,
    allowContact: input.allowContact,
  })

  await announceProductFeedback(report, await getOrganizationDisplayName(session.organizationId))

  const config = supportConfig()
  if (config) await openTicketFor(session, report, input, config)

  return { id: report.id, kind: report.kind, createdAt: report.createdAt.toISOString() }
}

function personUrl(config: PosthogSupportConfig | null, userId: string): string | null {
  return config ? `${config.appHost}/project/${config.projectId}/person/${encodeURIComponent(userId)}` : null
}

interface ViewerContext {
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

async function viewerContext(config: PosthogSupportConfig, session: UserSession | null): Promise<ViewerContext> {
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

async function ticketViews(
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

async function oneTicketView(
  config: PosthogSupportConfig,
  ticket: SupportTicket | null,
  session: UserSession | null
): Promise<ProductFeedbackTicketView | null> {
  if (!ticket) return null
  const views = await ticketViews(config, [ticket], await viewerContext(config, session))
  return views.get(ticket.id) ?? null
}

function toReportView(
  row: ProductFeedbackRow,
  ticket: ProductFeedbackTicketView | null,
  config: PosthogSupportConfig | null
): ProductFeedbackReportView {
  return {
    id: row.id,
    kind: row.kind,
    ticket,
    posthogPersonUrl: personUrl(config, row.userId),
    message: row.message,
    pagePath: row.pagePath,
    context: row.context ?? {},
    allowContact: row.allowContact,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    reporter: {
      userId: row.userId,
      name: row.userName,
      email: row.allowContact ? row.userEmail : null,
    },
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

async function withOrganizationNames(rows: ProductFeedbackRow[]): Promise<ProductFeedbackRow[]> {
  const names = await getOrganizationDisplayNames(
    rows.filter((row) => !row.organizationName).map((row) => row.organizationId)
  )
  return rows.map((row) => ({ ...row, organizationName: row.organizationName ?? names.get(row.organizationId) ?? null }))
}

export function encodeCursor(row: Pick<ProductFeedback, 'createdAt' | 'id'>): string {
  return `${new Date(row.createdAt).toISOString()}|${row.id}`
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined
  const [iso, id] = cursor.split('|')
  const createdAt = new Date(iso ?? '')
  if (!id || Number.isNaN(createdAt.getTime())) return undefined
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return { createdAt, id }
}

const OFFSET_CURSOR = /^o:(\d{1,6})$/

const pageLimit = (query: ListProductFeedbackQuery): number =>
  Math.min(query.limit ?? PRODUCT_FEEDBACK_LIST_LIMIT, PRODUCT_FEEDBACK_LIST_LIMIT)

function decodeOffset(cursor: string | undefined): number {
  const match = cursor ? OFFSET_CURSOR.exec(cursor) : null
  return match ? Number(match[1]) : 0
}

async function listLocal(
  query: ListProductFeedbackQuery,
  config: PosthogSupportConfig | null
): Promise<ProductFeedbackListResponse> {
  const rows = await listProductFeedback({
    kind: query.kind,
    before: decodeCursor(query.cursor),
    limit: pageLimit(query),
  })
  const last = rows.at(-1)
  return {
    source: 'local',
    reports: (await withOrganizationNames(rows)).map((row) => toReportView(row, null, config)),
    counts: null,
    unticketed: [],
    nextCursor: rows.length === pageLimit(query) && last ? encodeCursor(last) : null,
    viewerNotInPosthog: false,
  }
}

const zeroCounts = (): Record<SupportTicketStatus, number> =>
  Object.fromEntries(SUPPORT_TICKET_STATUSES.map((status) => [status, 0])) as Record<SupportTicketStatus, number>

function assigneeFilterOf(
  query: ListProductFeedbackQuery,
  context: ViewerContext
): SupportTicketAssigneeFilter | 'nobody' | undefined {
  if (query.assignee === 'unassigned') return 'unassigned'
  if (query.assignee !== 'mine') return undefined
  if (!context.members) throw new PosthogSupportUnavailableError('PostHog Support: members unreadable for `mine`')
  const viewer = context.viewerEmail ? memberByEmail(context.members, context.viewerEmail) : null
  return viewer ? { userId: viewer.id } : 'nobody'
}

async function listFromPosthog(
  query: ListProductFeedbackQuery,
  config: PosthogSupportConfig,
  session: UserSession | null
): Promise<ProductFeedbackListResponse> {
  const offset = decodeOffset(query.cursor)
  const context = await viewerContext(config, session)
  const assignee = assigneeFilterOf(query, context)
  if (assignee === 'nobody') {
    return { source: 'posthog', reports: [], counts: zeroCounts(), unticketed: [], nextCursor: null, viewerNotInPosthog: true }
  }
  const status = query.status === 'active' ? ACTIVE_SUPPORT_TICKET_STATUSES : query.status
  const [page, counts] = await Promise.all([
    listFeedbackTickets(config, { status, kind: query.kind, assignee, limit: pageLimit(query), offset }),
    countFeedbackTicketsByStatus(config, fetch, { assignee }),
  ])
  const since = new Date(Date.now() - UNTICKETED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const [byTicket, unticketedRows, views] = await Promise.all([
    getProductFeedbackByTicketIds(page.tickets.map((ticket) => ticket.id)),
    offset === 0 && !assignee
      ? listProductFeedback({ kind: query.kind, unticketed: true, since, limit: PRODUCT_FEEDBACK_LIST_LIMIT })
      : Promise.resolve([]),
    ticketViews(config, page.tickets, context),
  ])
  const joined = page.tickets.flatMap((ticket) => {
    const row = byTicket.get(ticket.id)
    return row ? [{ row, ticket }] : []
  })
  const named = await withOrganizationNames([...joined.map((entry) => entry.row), ...unticketedRows])
  const nextOffset = offset + page.tickets.length
  return {
    source: 'posthog',
    reports: joined.map((entry, index) =>
      toReportView(named[index] ?? entry.row, views.get(entry.ticket.id) ?? null, config)
    ),
    counts,
    unticketed: named.slice(joined.length).map((row) => toReportView(row, null, config)),
    nextCursor:
      page.tickets.length === pageLimit(query) && nextOffset < page.count ? `o:${nextOffset}` : null,
    viewerNotInPosthog: false,
  }
}

export async function listProductFeedbackForPlatform(
  session: UserSession | null,
  query: ListProductFeedbackQuery
): Promise<ProductFeedbackListResponse> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsView)
  const config = supportConfig()
  return withPlatformAccess('product feedback: triage list', async () => {
    if (!config) return listLocal(query, null)
    try {
      return await listFromPosthog(query, config, session)
    } catch (error) {
      if (!(error instanceof PosthogSupportUnavailableError)) throw error
      console.warn('[product-feedback] PostHog Support unreadable; listing the local log:', error.message)
      return listLocal({ ...query, cursor: undefined }, config)
    }
  })
}

async function ticketFor(row: ProductFeedbackRow, config: PosthogSupportConfig | null): Promise<SupportTicket | null> {
  if (!config || !row.posthogTicketId) return null
  try {
    return await getSupportTicket(config, row.posthogTicketId)
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    return null
  }
}

export async function getProductFeedbackForPlatform(
  session: UserSession | null,
  id: string
): Promise<ProductFeedbackReportView> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsView)
  const row = await withPlatformAccess('product feedback: one report', () => getProductFeedback(id))
  if (!row) throw new NotFoundError('Unknown feedback report.')
  const config = supportConfig()
  const [[named], ticket] = await Promise.all([withOrganizationNames([row]), ticketFor(row, config)])
  return toReportView(named ?? row, config ? await oneTicketView(config, ticket, session) : null, config)
}

export async function triageProductFeedback(
  session: UserSession | null,
  id: string,
  status: SupportTicketStatus
): Promise<ProductFeedbackReportView> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsManage)
  const row = await withPlatformAccess('product feedback: triage', () => getProductFeedback(id))
  if (!row) throw new NotFoundError('Unknown feedback report.')
  const config = supportConfig()
  if (!config || !row.posthogTicketId) {
    throw new ConflictError('This report has no PostHog Support ticket to move.')
  }
  let ticket: SupportTicket
  try {
    ticket = await updateSupportTicketStatus(config, row.posthogTicketId, status)
  } catch (error) {
    if (error instanceof PosthogSupportUnavailableError) throw new UpstreamError('PostHog Support did not take the change.')
    throw error
  }
  const [named] = await withOrganizationNames([row])
  return toReportView(named ?? row, await oneTicketView(config, ticket, session), config)
}

const OFFICE_VIEW_PERMISSION = ORG_PERMISSIONS.settingsManage

const OWN_TICKETS_LIMIT = 100

const EXCERPT_LENGTH = 140

const TICKET_SETUP_GRACE_MS = 60_000

function excerptOf(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

export function hasUpdateSince(row: ProductFeedback, ticket: SupportTicket | null): boolean {
  if (!ticket) return false
  const updated = new Date(ticket.updatedAt).getTime()
  if (row.reporterSeenAt) return updated > new Date(row.reporterSeenAt).getTime()
  return updated > new Date(row.createdAt).getTime() + TICKET_SETUP_GRACE_MS
}

function toOwnSummary(
  row: ProductFeedback,
  ticket: SupportTicket | null,
  config: PosthogSupportConfig | null,
  viewerId: string
): OwnProductFeedbackSummary {
  const mine = row.userId === viewerId
  const createdAt = new Date(row.createdAt).toISOString()
  return {
    id: row.id,
    kind: row.kind,
    excerpt: excerptOf(row.message),
    createdAt,
    status: ticket?.status ?? null,
    ticketNumber: ticket?.ticketNumber ?? null,
    lastActivityAt: ticket ? new Date(ticket.updatedAt).toISOString() : createdAt,
    hasUpdate: mine && hasUpdateSince(row, ticket),
    canReply: mine && Boolean(config && row.posthogTicketId && row.posthogWidgetSessionId),
    mine,
    reporterName: row.userName ?? null,
  }
}

async function ownReport(session: AuthorizedSession, id: string): Promise<ProductFeedback> {
  const row = await getOwnProductFeedback(session.organizationId, session.userId, id)
  if (!row) throw new NotFoundError('Unknown feedback report.')
  return row
}

async function readableReport(session: AuthorizedSession, id: string): Promise<ProductFeedback> {
  const own = await getOwnProductFeedback(session.organizationId, session.userId, id)
  if (own) return own
  if (!(await can(session, OFFICE_VIEW_PERMISSION))) throw new NotFoundError('Unknown feedback report.')
  const row = await getOrganizationProductFeedback(session.organizationId, id)
  if (!row) throw new NotFoundError('Unknown feedback report.')
  return row
}

async function ticketsFor(
  rows: ProductFeedback[],
  config: PosthogSupportConfig | null
): Promise<{ tickets: Map<string, SupportTicket>; live: boolean }> {
  if (!config) return { tickets: new Map(), live: false }
  const reporters = [...new Set(rows.filter((row) => row.posthogTicketId).map((row) => row.userId))]
  if (reporters.length === 0) return { tickets: new Map(), live: true }
  try {
    const found = await listFeedbackTicketsOf(config, reporters, OWN_TICKETS_LIMIT)
    return { tickets: new Map(found.map((ticket) => [ticket.id, ticket])), live: true }
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn('[product-feedback] PostHog Support unreadable; cases without status:', error.message)
    return { tickets: new Map(), live: false }
  }
}

function caseList(
  rows: ProductFeedback[],
  limit: number,
  found: { tickets: Map<string, SupportTicket>; live: boolean },
  config: PosthogSupportConfig | null,
  session: AuthorizedSession,
  canViewOffice: boolean
): OwnProductFeedbackListResponse {
  const reports = rows.map((row) =>
    toOwnSummary(row, row.posthogTicketId ? (found.tickets.get(row.posthogTicketId) ?? null) : null, config, session.userId)
  )
  const last = rows.at(-1)
  return {
    reports,
    updatedCount: reports.filter((report) => report.hasUpdate).length,
    live: found.live,
    nextCursor: rows.length === limit && last ? encodeCursor(last) : null,
    canViewOffice,
  }
}

export async function listOwnProductFeedbackThreads(
  session: AuthorizedSession,
  query: ListOwnProductFeedbackQuery = { limit: OWN_PRODUCT_FEEDBACK_LIMIT }
): Promise<OwnProductFeedbackListResponse> {
  const limit = Math.min(query.limit, OWN_PRODUCT_FEEDBACK_LIMIT)
  const rows = await listOwnProductFeedback(session.organizationId, session.userId, {
    limit,
    before: decodeCursor(query.cursor),
  })
  const config = supportConfig()
  const [found, canViewOffice] = await Promise.all([ticketsFor(rows, config), can(session, OFFICE_VIEW_PERMISSION)])
  return caseList(rows, limit, found, config, session, canViewOffice)
}

export async function listOfficeProductFeedbackThreads(
  session: AuthorizedSession,
  query: ListOfficeProductFeedbackQuery = { limit: OWN_PRODUCT_FEEDBACK_LIMIT }
): Promise<OwnProductFeedbackListResponse> {
  await authorize(session, OFFICE_VIEW_PERMISSION)
  const limit = Math.min(query.limit, OWN_PRODUCT_FEEDBACK_LIMIT)
  const rows = await listOrganizationProductFeedback(session.organizationId, {
    limit,
    before: decodeCursor(query.cursor),
  })
  const config = supportConfig()
  return caseList(rows, limit, await ticketsFor(rows, config), config, session, true)
}

function threadMessages(row: ProductFeedback, ticketMessages: SupportMessage[]): OwnProductFeedbackMessage[] {
  const header = `[${row.kind}] #${row.id}`
  const first: OwnProductFeedbackMessage = {
    id: row.id,
    author: 'reporter',
    authorName: null,
    content: row.message,
    createdAt: new Date(row.createdAt).toISOString(),
  }
  const rest = ticketMessages
    .filter((message) => !(message.author === 'customer' && message.content.startsWith(header)))
    .map((message) => ({
      id: message.id,
      author: message.author === 'customer' ? ('reporter' as const) : ('team' as const),
      authorName: message.authorName,
      content: message.content,
      createdAt: message.createdAt,
    }))
  return [first, ...rest]
}

async function liveThread(
  row: ProductFeedback,
  config: PosthogSupportConfig | null
): Promise<{ ticket: SupportTicket; messages: SupportMessage[] } | null> {
  if (!config || !row.posthogTicketId) return null
  try {
    const [ticket, messages] = await Promise.all([
      getSupportTicket(config, row.posthogTicketId),
      listCustomerVisibleMessages(config, row.posthogTicketId),
    ])
    return ticket ? { ticket, messages } : null
  } catch (error) {
    if (!(error instanceof PosthogSupportUnavailableError)) throw error
    console.warn(`[product-feedback] thread of report ${row.id} unreadable:`, error.message)
    return null
  }
}

export async function getOwnProductFeedbackThread(
  session: AuthorizedSession,
  id: string
): Promise<OwnProductFeedbackThread> {
  const row = await readableReport(session, id)
  const mine = row.userId === session.userId
  const config = supportConfig()
  const live = await liveThread(row, config)
  const seenAt = new Date()
  if (live && mine) await markOwnProductFeedbackSeen(session.organizationId, session.userId, row.id, seenAt)
  const seen = live && mine ? { ...row, reporterSeenAt: seenAt } : row
  return {
    report: toOwnSummary(seen, live?.ticket ?? null, config, session.userId),
    messages: threadMessages(row, live?.messages ?? []),
    live: live !== null,
  }
}

export async function replyToOwnProductFeedback(
  session: AuthorizedSession,
  id: string,
  message: string
): Promise<OwnProductFeedbackThread> {
  const row = await ownReport(session, id)
  const config = supportConfig()
  if (!config || !row.posthogTicketId || !row.posthogWidgetSessionId) {
    throw new ConflictError('This report cannot be answered here.')
  }
  let masked: string
  try {
    masked = (await maskChatText(session.organizationId, message)).text
  } catch (error) {
    console.error(`[product-feedback] reply on report ${row.id} not sent: the policy could not mask it`, error)
    throw new UpstreamError('Your reply could not be sent.')
  }
  try {
    await replyAsCustomer(config, {
      ticketId: row.posthogTicketId,
      widgetSessionId: row.posthogWidgetSessionId,
      distinctId: session.userId,
      message: masked,
    })
  } catch (error) {
    if (error instanceof PosthogSupportUnavailableError) throw new UpstreamError('Your reply could not be sent.')
    throw error
  }
  announceToSupport('product_feedback_reply_sent', session, row, row.posthogTicketId)
  return getOwnProductFeedbackThread(session, id)
}

export async function claimProductFeedbackTicket(
  session: UserSession | null,
  ticketId: string
): Promise<ProductFeedbackReportView> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.settingsManage)
  const config = supportConfig()
  if (!config) throw new ConflictError('PostHog Support is not configured here.')
  const row = await withPlatformAccess('product feedback: claim', async () =>
    (await getProductFeedbackByTicketIds([ticketId])).get(ticketId)
  )
  if (!row) throw new NotFoundError('Unknown feedback ticket.')
  const email = session?.email?.trim()
  if (!email) throw new ConflictError('Your account has no email to find you in PostHog by.')
  let ticket: SupportTicket
  try {
    const posthogUserId = await findPosthogUserIdByEmail(config, email)
    if (posthogUserId === null) {
      throw new ConflictError('Nobody in PostHog has your email, so the ticket cannot be assigned to you.')
    }
    ticket = await assignSupportTicket(config, ticketId, posthogUserId)
  } catch (error) {
    if (error instanceof PosthogSupportUnavailableError) throw new UpstreamError('PostHog Support did not take the change.')
    throw error
  }
  const [named] = await withOrganizationNames([row])
  return toReportView(named ?? row, await oneTicketView(config, ticket, session), config)
}
