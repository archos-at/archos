import type { TurnView } from './turn-fold'

export type UnseenEnd = 'answered' | 'failed'
export type ConversationActivity = 'working' | 'waiting' | UnseenEnd

export const conversationActivity = (
  turns: Record<string, TurnView>,
  unseenAnswers: Record<string, UnseenEnd>,
  conversationId: string
): ConversationActivity | null => {
  const view = Object.values(turns).find((each) => each.conversationId === conversationId && each.phase === 'running')
  if (view) return view.interaction ? 'waiting' : 'working'
  return unseenAnswers[conversationId] ?? null
}
