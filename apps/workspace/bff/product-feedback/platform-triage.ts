import 'server-only'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import {
  assignSupportTicket,
  findPosthogUserIdByEmail,
  getSupportTicket,
  updateSupportTicketStatus,
} from '@/lib/posthog-support/client'
import {
  PosthogSupportUnavailableError,
  type PosthogSupportConfig,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/lib/posthog-support/types'
import { getProductFeedback, getProductFeedbackByTicketIds, type ProductFeedbackRow } from './repository'
import { toReportView, withOrganizationNames } from './report-views'
import { supportConfig } from './support-config'
import { oneTicketView } from './ticket-views'
import type { ProductFeedbackReportView } from './types'

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
