import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import { isOrgAdmin } from './organizations'
import { isPlatformStaff } from './platform'
import { inboxIsReachable } from '@/lib/inbox/registry'
import { isCollaborationEnabled, isOfficeStandardsEnabled } from './feature-flags'

export interface NavFlags {
  canManageOrganization: boolean
  canViewOrganization: boolean
  canManagePlatform: boolean
  canAccessOfficeShelf: boolean
  canAccessOfficeStandards: boolean
  canCollaborate: boolean
  canAccessInbox: boolean
}

export async function getNavFlags(session: UserSession | null): Promise<NavFlags> {
  if (!session) {
    return {
      canManageOrganization: false,
      canViewOrganization: false,
      canManagePlatform: false,
      canAccessOfficeShelf: false,
      canAccessOfficeStandards: false,
      canCollaborate: false,
      canAccessInbox: false,
    }
  }
  const collaboration = isCollaborationEnabled(session)
  return {
    canManageOrganization: isOrgAdmin(session),
    canViewOrganization: true,
    canManagePlatform: await isPlatformStaff(session),
    canAccessOfficeShelf: Boolean(session.organizationId),
    canAccessOfficeStandards: Boolean(session.organizationId) && isOfficeStandardsEnabled(session),
    canCollaborate: collaboration,
    canAccessInbox: Boolean(session.organizationId) && inboxIsReachable(collaboration),
  }
}
