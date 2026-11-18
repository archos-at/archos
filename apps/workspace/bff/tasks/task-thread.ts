import { v5 as uuidv5 } from 'uuid'

export function taskThreadConversationId(definitionId: string): string {
  return `s_${uuidv5(`grid:task-thread:${definitionId}`, uuidv5.URL).replace(/-/g, '_')}`
}

export function isTaskThread(conversation: { id?: string | null; jobId?: string | null }): boolean {
  if (!conversation.jobId || !conversation.id) return false
  return conversation.id === taskThreadConversationId(conversation.jobId)
}
