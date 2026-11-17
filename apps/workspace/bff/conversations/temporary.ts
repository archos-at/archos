import 'server-only'
import { NotFoundError, TemporaryConversationError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Conversation } from '@/lib/db/schema/conversations'
import { requireResourceAccess } from '@/lib/sharing/access'
import { readConversationTemporary, updateConversationTemporaryInOrg } from './temporary-repository'

export async function isTemporaryConversation(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<boolean> {
  if (!conversationId || !organizationId) return false
  return readConversationTemporary(conversationId, organizationId)
}

export async function requireConversationKeepsMemory(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<void> {
  if (await isTemporaryConversation(conversationId, organizationId)) throw new TemporaryConversationError()
}

export async function setConversationTemporary(
  session: AuthorizedSession,
  conversationId: string,
  temporary: boolean
): Promise<Conversation> {
  await requireResourceAccess(session, 'conversation', conversationId, 'owner')
  const conversation = await updateConversationTemporaryInOrg(conversationId, session.organizationId, temporary)
  if (!conversation) throw new NotFoundError()
  return conversation
}
