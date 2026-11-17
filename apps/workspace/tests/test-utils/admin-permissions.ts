import { findRoleSpec } from '@/lib/authz/catalog'

export function adminPermissions(): string[] {
  return [...(findRoleSpec('admin')?.permissions ?? [])]
}
