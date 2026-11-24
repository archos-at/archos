import 'server-only'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'
import type { PosthogSupportConfig } from '@/lib/posthog-support/types'
import type { ProductFeedbackRow } from './repository'
import type { ProductFeedbackReportView, ProductFeedbackTicketView } from './types'

function personUrl(config: PosthogSupportConfig | null, userId: string): string | null {
  return config ? `${config.appHost}/project/${config.projectId}/person/${encodeURIComponent(userId)}` : null
}

export function toReportView(
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

export async function withOrganizationNames(rows: ProductFeedbackRow[]): Promise<ProductFeedbackRow[]> {
  const names = await getOrganizationDisplayNames(
    rows.filter((row) => !row.organizationName).map((row) => row.organizationId)
  )
  return rows.map((row) => ({ ...row, organizationName: row.organizationName ?? names.get(row.organizationId) ?? null }))
}
