import 'server-only'
import { findRoleSpec } from '@/lib/authz/catalog'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { withTenant } from '@/lib/db/tenant-context'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, type InboxEmission } from '@/lib/inbox/service'
import { listOrganizationMembersWithRoles } from '@/lib/organizations/service'

export const FEEDBACK_INBOX_TYPE = 'feedback.submitted' as const

export const FEEDBACK_TRIAGE_PERMISSION = PLATFORM_PERMISSIONS.settingsManage

const EXCERPT_MAX = 500

export async function findFeedbackRecipients(platformOrganizationId: string): Promise<string[]> {
  const members = await listOrganizationMembersWithRoles(platformOrganizationId)
  return members
    .filter((member) => member.status === 'active')
    .filter((member) => {
      const spec = member.roleSlug ? findRoleSpec(member.roleSlug) : null
      return spec ? spec.permissions.includes(FEEDBACK_TRIAGE_PERMISSION) : false
    })
    .map((member) => member.id)
}

export function feedbackEmissions(
  report: Pick<
    ProductFeedback,
    'id' | 'kind' | 'message' | 'userId' | 'userName' | 'userEmail' | 'allowContact'
  >,
  organizationName: string | null,
  platformOrganizationId: string,
  recipients: readonly string[]
): InboxEmission[] {
  const groupKey = inboxGroupKey(FEEDBACK_INBOX_TYPE, 'product_feedback', report.id)
  const message = report.message.trim()
  return recipients.map((recipientUserId) => ({
    organizationId: platformOrganizationId,
    recipientUserId,
    type: FEEDBACK_INBOX_TYPE,
    resourceType: 'product_feedback',
    resourceId: report.id,
    actorUserId: report.userId,
    groupKey,
    payload: {
      subject: organizationName ?? undefined,
      excerpt: message.length > EXCERPT_MAX ? `${message.slice(0, EXCERPT_MAX)}…` : message,
      actorName: report.userName ?? (report.allowContact ? report.userEmail : null) ?? undefined,
      kind: report.kind,
    },
  }))
}

export type FeedbackAnnouncement =
  | { status: 'announced'; recipients: number }
  | { status: 'no-platform-organization' }
  | { status: 'no-recipients' }
  | { status: 'failed' }

export async function announceProductFeedback(
  report: ProductFeedback,
  organizationName: string | null
): Promise<FeedbackAnnouncement> {
  try {
    const platformOrganizationId = await getPlatformOrganizationId()
    if (!platformOrganizationId) {
      console.warn(
        `[product-feedback] report ${report.id} stored, but no platform organization is provisioned — nobody was notified`
      )
      return { status: 'no-platform-organization' }
    }
    const recipients = await findFeedbackRecipients(platformOrganizationId)
    if (recipients.length === 0) {
      console.warn(
        `[product-feedback] report ${report.id} stored, but no platform member holds "${FEEDBACK_TRIAGE_PERMISSION}" — nobody was notified`
      )
      return { status: 'no-recipients' }
    }
    await withTenant({ organizationId: platformOrganizationId }, () =>
      emitInboxItems(feedbackEmissions(report, organizationName, platformOrganizationId, recipients))
    )
    return { status: 'announced', recipients: recipients.length }
  } catch (error) {
    console.error(`[product-feedback] announcing report ${report.id} failed:`, error)
    return { status: 'failed' }
  }
}
