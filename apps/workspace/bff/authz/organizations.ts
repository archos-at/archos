import type { UserSession } from '@/lib/auth/types'
import { hasPermission, ORG_PERMISSIONS } from './permissions'

export const USERS_TABLE_MANAGE = 'widgets:users-table:manage'

type SessionSlice = Pick<UserSession, 'role' | 'permissions'>

export function isOrgAdmin(session: SessionSlice): boolean {
  return (
    hasPermission(session, ORG_PERMISSIONS.settingsManage) ||
    session.permissions.includes(USERS_TABLE_MANAGE)
  )
}

export function canManageModels(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.modelsManage)
}

export function canManageBudgets(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.budgetsManage)
}

export function canManageCompliance(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.complianceManage)
}

export function canViewAuditLogs(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.auditView)
}

export function canViewDownloadLog(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.downloadLogView)
}

export function canManageMembers(session: SessionSlice): boolean {
  return (
    hasPermission(session, ORG_PERMISSIONS.membersManage) ||
    session.permissions.includes(USERS_TABLE_MANAGE)
  )
}

export function canManageOfficeShelf(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.officeShelfManage)
}

export function canManageSkills(session: SessionSlice): boolean {
  return hasPermission(session, ORG_PERMISSIONS.skillsManage)
}

export const ORG_WIDGET_PERMISSIONS = [
  'widgets:users-table:manage',
  'widgets:sso:manage',
  'widgets:dsync:manage',
  'widgets:domain-verification:manage',
  'widgets:audit-log-streaming:manage',
] as const

export type OrgWidgetPermission = (typeof ORG_WIDGET_PERMISSIONS)[number]
