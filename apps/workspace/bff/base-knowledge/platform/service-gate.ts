import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import type { PlatformPermission } from '@/lib/authz/permissions'
import { requirePlatformPermission } from '@/lib/authz/platform'

export async function requirePlatform(session: UserSession | null, permission: PlatformPermission): Promise<UserSession> {
  await requirePlatformPermission(session, permission)
  return session as UserSession
}
