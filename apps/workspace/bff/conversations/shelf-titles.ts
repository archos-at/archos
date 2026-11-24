import 'server-only'
import { actingOwnShelfReadable, actingReaderIsAgent } from '@/lib/agent-api/acting-session'

export interface ShelfMarkedChat {
  createdBy: string
  personalShelfUsedAt: Date | null
}

export function hidesShelfChatFromAgent(chat: ShelfMarkedChat, userId: string): boolean {
  if (!actingReaderIsAgent() || !chat.personalShelfUsedAt) return false
  return !(chat.createdBy === userId && actingOwnShelfReadable())
}
