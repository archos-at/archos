import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'

export const LIVE_REAUTHORIZE_MS = 30_000

export async function requireConversationSpectator(
  session: AuthorizedSession,
  conversationId: string,
): Promise<void> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
}

export async function stillMayWatchConversation(
  session: AuthorizedSession,
  conversationId: string,
): Promise<boolean> {
  try {
    await requireConversationSpectator(session, conversationId)
    return true
  } catch {
    return false
  }
}
