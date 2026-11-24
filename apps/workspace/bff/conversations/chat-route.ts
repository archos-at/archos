import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isAuthzRefusal } from '@/lib/api/errors'
import { requireResourceAccess } from '@/lib/sharing/access'
import { findConversationTenancy } from './repository'

export function chatRouteOf(projectId: string | null, conversationId?: string): string {
  const base = projectId ? `/app/projects/${encodeURIComponent(projectId)}/chat` : '/app/personal/chat'
  return conversationId ? `${base}?session=${encodeURIComponent(conversationId)}` : base
}

export async function chatRouteElsewhere(
  session: AuthorizedSession,
  conversationId: string,
  side: string | null
): Promise<string | null> {
  const row = await findConversationTenancy(conversationId)
  if (!row || row.deletedAt) return null
  if (row.organizationId !== session.organizationId) return chatRouteOf(side)
  if ((row.projectId ?? null) === side) return null
  try {
    await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  } catch (error) {
    if (isAuthzRefusal(error)) return chatRouteOf(side)
    throw error
  }
  return chatRouteOf(row.projectId ?? null, conversationId)
}
