import type { UserSession } from '@/lib/auth/types'

export function memberSubject(session: Pick<UserSession, 'organizationId' | 'userId'>): string {
  return `${session.organizationId ?? 'no-org'}:${session.userId}`
}
