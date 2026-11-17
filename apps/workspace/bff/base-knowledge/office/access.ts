import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'

export function requireOfficeStandardsEnabled(session: Pick<UserSession, 'featureFlags'>): void {
  if (!isOfficeStandardsEnabled(session)) throw new NotFoundError()
}

export function officeStandardsEnabled(organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.officeStandards, organizationId)
}
