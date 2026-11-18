import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { can } from '@/lib/authz/decide'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { getOrganizationProductFeedback, getOwnProductFeedback } from './repository'

export const OFFICE_VIEW_PERMISSION = ORG_PERMISSIONS.settingsManage

export async function ownReport(session: AuthorizedSession, id: string): Promise<ProductFeedback> {
  const row = await getOwnProductFeedback(session.organizationId, session.userId, id)
  if (!row) throw new NotFoundError('Unknown feedback report.')
  return row
}

export async function readableReport(session: AuthorizedSession, id: string): Promise<ProductFeedback> {
  const own = await getOwnProductFeedback(session.organizationId, session.userId, id)
  if (own) return own
  if (!(await can(session, OFFICE_VIEW_PERMISSION))) throw new NotFoundError('Unknown feedback report.')
  const row = await getOrganizationProductFeedback(session.organizationId, id)
  if (!row) throw new NotFoundError('Unknown feedback report.')
  return row
}
