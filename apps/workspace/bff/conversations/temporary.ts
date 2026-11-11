/**
 * A temporary conversation keeps nothing (ADR-0180 rule 2): no project memory,
 * no organization memory, no personal memory.
 *
 * The promise is held at the writer. Both internal memory routes call
 * {@link requireConversationKeepsMemory} before they write, so it holds
 * whatever the agent does; the turn context also says `temporary`, so the
 * agent skips its `remember` tool and the reflection stage and saves the call.
 * Reading is untouched: a temporary conversation is still given the project's
 * and the person's memory.
 */

import 'server-only'
import { NotFoundError, TemporaryConversationError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Conversation } from '@/lib/db/schema/conversations'
import { requireResourceAccess } from '@/lib/sharing/access'
import { readConversationTemporary, updateConversationTemporaryInOrg } from './temporary-repository'

/**
 * Whether nothing may be kept from this conversation. A write that names no
 * conversation is not one a chat turn made, and a conversation whose row does
 * not exist yet is not temporary.
 */
export async function isTemporaryConversation(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<boolean> {
  if (!conversationId || !organizationId) return false
  return readConversationTemporary(conversationId, organizationId)
}

/** Refuse a memory write that names a temporary conversation of this organization, before anything is written. */
export async function requireConversationKeepsMemory(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<void> {
  if (await isTemporaryConversation(conversationId, organizationId)) throw new TemporaryConversationError()
}

/**
 * Switch a conversation's `temporary` flag. An owner's call, like its name:
 * the flag decides what the office keeps from the thread, for everyone in it.
 * Switching it off keeps nothing from the turns before; switching it on
 * removes nothing that was already kept.
 */
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
