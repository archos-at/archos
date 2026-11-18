import { v5 as uuidv5 } from 'uuid'

export function askAnswerMessageId(conversationId: string, turnId: string): string {
  return uuidv5(`grid:assistant:${conversationId}:${turnId}`, uuidv5.URL)
}
