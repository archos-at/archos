import { v5 as uuidv5 } from 'uuid'

export function wakeTurnId(eventId: string): string {
  return uuidv5(`grid:piloti-wake:${eventId}`, uuidv5.URL)
}

export function delegationEventId(annotationId: string, delegatedAt: Date | string): string {
  const at = typeof delegatedAt === 'string' ? delegatedAt : delegatedAt.toISOString()
  return uuidv5(`grid:annotation-delegation:${annotationId}:${at}`, uuidv5.URL)
}

export function documentThreadConversationId(documentId: string, userId: string): string {
  return `s_${uuidv5(`grid:document-thread:${documentId}:${userId}`, uuidv5.URL).replace(/-/g, '_')}`
}
