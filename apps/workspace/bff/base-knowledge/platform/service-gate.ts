/**
 * The gate every platform-knowledge service passes first (ADR-0165): the
 * platform permission. The `platform-base-knowledge` switch that followed it is
 * gone (ADR-0175): the records are the only source of a country's law.
 */

import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import type { PlatformPermission } from '@/lib/authz/permissions'
import { requirePlatformPermission } from '@/lib/authz/platform'

export async function requirePlatform(session: UserSession | null, permission: PlatformPermission): Promise<UserSession> {
  await requirePlatformPermission(session, permission)
  return session as UserSession
}
