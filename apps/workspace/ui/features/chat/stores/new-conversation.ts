/**
 * A conversation as this page mints it, before the server has a row for it.
 * Moved out of `sessions-store.ts`, its only caller.
 */

import { v4 as uuidv4 } from 'uuid'
import type { Conversation } from '../types'
import { markConversationMinted } from '../lib/conversation-on-server'

/** An id minted here names nothing on the server until its first message is stored. */
const mintConversationId = (): string => {
  const id = `s_${uuidv4().replace(/-/g, '_')}`
  markConversationMinted(id)
  return id
}

export const createNewConversation = (
  userId: string,
  projectId: string | null,
  subject?: { resourceType: 'document'; resourceId: string; title?: string | null } | null
): Conversation => ({
  id: mintConversationId(),
  userId,
  // Stamp the active project so the session stays scoped to it (UX-8);
  // null = created outside a project context (visible everywhere).
  projectId,
  title: subject?.title ?? '',
  subjectResourceType: subject?.resourceType ?? null,
  subjectResourceId: subject?.resourceId ?? null,
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})
