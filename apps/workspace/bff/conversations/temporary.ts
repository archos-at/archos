import 'server-only'
import { NotFoundError, TemporaryConversationError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Conversation } from '@/lib/db/schema/conversations'
import { requireResourceAccess } from '@/lib/sharing/access'
import { personalConversationHidden } from './repository'
import { readConversationTemporary, updateConversationTemporaryInOrg } from './temporary-repository'

export async function isTemporaryConversation(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<boolean> {
  if (!conversationId || !organizationId) return false
  return (await readConversationTemporary(conversationId, organizationId)) ?? false
}

export async function requireConversationKeepsMemory(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<void> {
  if (!conversationId || !organizationId) return
  const temporary = await readConversationTemporary(conversationId, organizationId)
  if (temporary === null && (await personalConversationHidden(conversationId))) throw new NotFoundError()
  if (temporary) throw new TemporaryConversationError()
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
