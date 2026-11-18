import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { hasFinishedRun, hasLiveRun } from '@/features/chat/lib/session-activity'
import { conversationActivity, type ConversationActivity } from '@/lib/turns/conversation-activity'
import { conversationMatchesProject, isHiddenJobConversation } from '@/features/chat/lib/project-scope'

export interface SessionRow {
  id: string
  title: string
  date: Date
  hasActiveDeepResearch: boolean
  hasCompletedReport: boolean
  contentLocked: boolean
  temporary: boolean
  activity: ConversationActivity | null
}

interface RowCache {
  byConversation: WeakMap<Conversation, SessionRow>
  byId: Map<string, SessionRow>
}

const sameRow = (a: SessionRow, b: SessionRow): boolean =>
  a.title === b.title &&
  +new Date(a.date) === +new Date(b.date) &&
  a.hasActiveDeepResearch === b.hasActiveDeepResearch &&
  a.hasCompletedReport === b.hasCompletedReport &&
  a.contentLocked === b.contentLocked &&
  a.temporary === b.temporary &&
  a.activity === b.activity

const rowFor = (conversation: Conversation, activity: ConversationActivity | null, cache: RowCache): SessionRow => {
  const known = cache.byConversation.get(conversation)
  if (known && known.activity === activity) return known
  const built: SessionRow = {
    id: conversation.id,
    title: conversation.title,
    date: conversation.updatedAt,
    hasActiveDeepResearch: hasLiveRun(conversation.messages),
    hasCompletedReport: hasFinishedRun(conversation.messages),
    contentLocked: conversation.contentLocked === true,
    temporary: conversation.temporary === true,
    activity,
  }
  const previous = cache.byId.get(conversation.id)
  const row = previous && sameRow(previous, built) ? previous : built
  cache.byConversation.set(conversation, row)
  cache.byId.set(conversation.id, row)
  return row
}

export function useSessionRows(projectId?: string | null): SessionRow[] {
  const cache = useRef<RowCache>({ byConversation: new WeakMap(), byId: new Map() })
  return useChatStore(
    useShallow((s) => {
      if (!s.currentUserId) return []
      const scope = projectId === undefined ? s.projectId : projectId
      return (
        s.conversations
          .filter((c) => c.userId === s.currentUserId && conversationMatchesProject(c, scope) && !isHiddenJobConversation(c))
          .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
          .map((c) => rowFor(c, conversationActivity(s.turns, s.unseenAnswers, c.id), cache.current))
      )
    })
  )
}
