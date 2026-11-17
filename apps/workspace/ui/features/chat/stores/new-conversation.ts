import { v4 as uuidv4 } from 'uuid'
import type { Conversation } from '../types'
import { markConversationMinted } from '../lib/conversation-on-server'

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
  projectId,
  title: subject?.title ?? '',
  subjectResourceType: subject?.resourceType ?? null,
  subjectResourceId: subject?.resourceId ?? null,
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})
