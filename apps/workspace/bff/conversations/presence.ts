import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { publishToUsers } from '@/lib/events/bus'
import { isShared, requireResourceAccess } from '@/lib/sharing/access'
import { consumeLimit, memberSubject, TYPING_LIMIT } from '@/lib/limits'
import { countGrantsForResource } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { TYPING_TTL_MS } from './presence-contract'

export async function publishTypingPresence(
  session: AuthorizedSession,
  conversationId: string,
  typing: boolean,
): Promise<void> {
  if (!isCollaborationEnabled(session)) return

  const access = await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')

  const shared = isShared(
    access.visibility,
    access.visibility === 'private'
      ? await countGrantsForResource('conversation', conversationId)
      : 0,
  )
  if (!shared) return

  const limit = await consumeLimit(TYPING_LIMIT, memberSubject(session))
  if (!limit.allowed) return

  const participants = await resolveParticipants(
    session.organizationId,
    'conversation',
    conversationId,
  )
  const audience = participants.filter((userId) => userId !== session.userId)
  if (audience.length === 0) return

  await publishToUsers(audience, {
    kind: 'conversation.typing',
    conversationId,
    userId: session.userId,
    typing,
    ttlMs: TYPING_TTL_MS,
  })
}
