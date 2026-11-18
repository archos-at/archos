import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findUserPreferences, upsertUserPreferences } from './repository'

export async function getUserPreferences(session: AuthorizedSession): Promise<Record<string, unknown>> {
  return (await findUserPreferences(session.userId, session.organizationId)) ?? {}
}

export async function mergeUserPreferences(
  session: AuthorizedSession,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = (await findUserPreferences(session.userId, session.organizationId)) ?? {}
  const merged = { ...existing, ...patch }
  await upsertUserPreferences(session.userId, session.organizationId, merged)
  return merged
}
