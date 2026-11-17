import { findPermissionSpec } from '@/lib/authz/catalog'
import type { Translator } from '@/i18n/translate'

export const PERMISSION_LABEL_KEYS: Readonly<Record<string, string>> = {
  'org:settings:manage': 'settings_manage',
  'org:models:manage': 'models_manage',
  'org:budgets:manage': 'budgets_manage',
  'org:compliance:manage': 'compliance_manage',
  'org:audit:view': 'audit_view',
  'org:downloads:view': 'downloads_view',
  'org:office_shelf:manage': 'office_shelf_manage',
  'org:skills:manage': 'skills_manage',
  'org:projects:create': 'projects_create',
  'org:projects:administer': 'projects_administer',
  'org:members:manage': 'members_manage',
}

export interface PermissionLabel {
  name: string
  hint: string | null
}

export function permissionLabel(t: Translator, slug: string): PermissionLabel {
  const key = PERMISSION_LABEL_KEYS[slug]
  if (key) {
    return { name: t(`customRoles.permission.${key}.name`), hint: t(`customRoles.permission.${key}.hint`) }
  }
  return { name: findPermissionSpec(slug)?.name ?? slug, hint: null }
}
