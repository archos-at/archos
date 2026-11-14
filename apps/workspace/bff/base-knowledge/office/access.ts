/**
 * The office's switch for its own standards (ADR-0163): the `office-standards`
 * entitlement (`bff/authz/feature-flags.ts`). Every office route under
 * `/api/base-knowledge` asks here first, and the turn asks for its
 * organization, so the rule is written once.
 *
 * Off, the office's base knowledge is not found, exactly as an entry the caller
 * may not read: a 404, never a 403, so a client learns nothing about a feature
 * the office does not have. The platform's released country knowledge (the
 * coverage, the edition in force on a day, a report of wrong law) is not the
 * office's and is not asked here.
 */

import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'

/** The session's `office-standards` entitlement, as a 404 when it is off. */
export function requireOfficeStandardsEnabled(session: Pick<UserSession, 'featureFlags'>): void {
  if (!isOfficeStandardsEnabled(session)) throw new NotFoundError()
}

/** Whether the organization has its own standards, read without a session (the turn). */
export function officeStandardsEnabled(organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.officeStandards, organizationId)
}
