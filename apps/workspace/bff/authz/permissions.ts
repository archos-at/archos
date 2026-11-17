import type { UserSession } from '@/lib/auth/types'
import {
  ORG_PERMISSION_SPECS,
  PLATFORM_PERMISSION_SPECS,
  PROJECT_PERMISSION_SPECS,
  FOLDER_PERMISSION_SPECS,
} from './catalog'

export const ORG_PERMISSIONS = {
  settingsManage: 'org:settings:manage',
  modelsManage: 'org:models:manage',
  budgetsManage: 'org:budgets:manage',
  complianceManage: 'org:compliance:manage',
  auditView: 'org:audit:view',
  downloadLogView: 'org:downloads:view',
  officeShelfManage: 'org:office_shelf:manage',
  skillsManage: 'org:skills:manage',
  projectsCreate: 'org:projects:create',
  membersManage: 'org:members:manage',
  projectsAdminister: 'org:projects:administer',
} as const

export const PLATFORM_PERMISSIONS = {
  organizationsView: 'platform:organizations:view',
  organizationsManage: 'platform:organizations:manage',
  usageView: 'platform:usage:view',
  settingsView: 'platform:settings:view',
  settingsManage: 'platform:settings:manage',
  observabilityView: 'platform:observability:view',
  knowledgeWrite: 'platform:knowledge:write',
  knowledgeReview: 'platform:knowledge:review',
  knowledgeApproveAsDomainExpert: 'platform:knowledge:approve_as_domain_expert',
  knowledgeApproveAsCounsel: 'platform:knowledge:approve_as_counsel',
  knowledgeApproveAsPrivacyReviewer: 'platform:knowledge:approve_as_privacy_reviewer',
  knowledgeApproveAlone: 'platform:knowledge:approve_alone',
} as const

export const PROJECT_PERMISSIONS = {
  view: 'project:view',
  chat: 'project:chat',
  /** @deprecated Umbrella write kept for existing grants; prefer the specific ones. */
  edit: 'project:edit',
  documentsWrite: 'project:documents:write',
  documentsGenerate: 'project:documents:generate',
  memoryWrite: 'project:memory:write',
  manage: 'project:manage',
  membersManage: 'project:members:manage',
  skillsManage: 'project:skills:manage',
} as const

export const FOLDER_PERMISSIONS = {
  read: 'folder:read',
  write: 'folder:write',
} as const

export type OrgPermission = (typeof ORG_PERMISSIONS)[keyof typeof ORG_PERMISSIONS]
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS]
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[keyof typeof PROJECT_PERMISSIONS]
export type FolderPermission = (typeof FOLDER_PERMISSIONS)[keyof typeof FOLDER_PERMISSIONS]

export type KnownPermission = OrgPermission | PlatformPermission

export type AnyPermission = KnownPermission | ProjectPermission

const RENAMED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [ORG_PERMISSIONS.officeShelfManage]: ['org:archiv:manage'],
}

export function acceptedPermissionSlugs(permission: string): readonly string[] {
  return [permission, ...(RENAMED_PERMISSIONS[permission] ?? [])]
}

export function hasPermission(session: Pick<UserSession, 'permissions'>, permission: KnownPermission): boolean {
  return acceptedPermissionSlugs(permission).some((slug) => session.permissions.includes(slug))
}

export const ALL_ORG_PERMISSION_SLUGS: readonly string[] = ORG_PERMISSION_SPECS.map(
  (permission) => permission.slug
)
export const ALL_PLATFORM_PERMISSION_SLUGS: readonly string[] = PLATFORM_PERMISSION_SPECS.map(
  (permission) => permission.slug
)
export const ALL_PROJECT_PERMISSION_SLUGS: readonly string[] = PROJECT_PERMISSION_SPECS.map(
  (permission) => permission.slug
)
export const ALL_FOLDER_PERMISSION_SLUGS: readonly string[] = FOLDER_PERMISSION_SPECS.map(
  (permission) => permission.slug
)
