/**
 * The sessions panel's rows, selected so that a streamed answer does not
 * re-render the layout.
 *
 * Every delta flush replaces the open conversation in `conversations`, so a
 * list derived from that array is a new list on every frame of an answer even
 * though nothing a row shows has changed. Here each row is reused while its
 * fields are the same, and the list is compared item by item: the layout and
 * the panel re-render when a row actually changes (a new session, a title, a
 * run starting or finishing), not with every delta.
 */

import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { hasFinishedRun, hasLiveRun } from '@/features/chat/lib/session-activity'
import { conversationMatchesProject, isHiddenJobConversation } from '@/features/chat/lib/project-scope'

export interface SessionRow {
  id: string
  title: string
  date: Date
  /** A run is still going in this thread (read off its stored ledger). */
  hasActiveDeepResearch: boolean
  /** A run in this thread finished with a report. */
  hasCompletedReport: boolean
  /** The reader may no longer read this chat (ADR-0088): shown under a neutral title. */
  contentLocked: boolean
  /** Nothing from this chat is kept in memory (ADR-0180): the history marks its row. */
  temporary: boolean
}

interface RowCache {
  /** The row last built for a conversation object, so an unchanged one costs nothing. */
  byConversation: WeakMap<Conversation, SessionRow>
  /** The row last shown for an id, reused when a new object yields the same row. */
  byId: Map<string, SessionRow>
}

/** Would the panel draw these two rows the same? */
const sameRow = (a: SessionRow, b: SessionRow): boolean =>
  a.title === b.title &&
  +new Date(a.date) === +new Date(b.date) &&
  a.hasActiveDeepResearch === b.hasActiveDeepResearch &&
  a.hasCompletedReport === b.hasCompletedReport &&
  a.contentLocked === b.contentLocked &&
  a.temporary === b.temporary

/**
 * The row for one conversation: cached for the object, and the previous row
 * for its id when a new object yields the same fields.
 */
const rowFor = (conversation: Conversation, cache: RowCache): SessionRow => {
  const known = cache.byConversation.get(conversation)
  if (known) return known
  const built: SessionRow = {
    id: conversation.id,
    title: conversation.title,
    date: conversation.updatedAt,
    hasActiveDeepResearch: hasLiveRun(conversation.messages),
    hasCompletedReport: hasFinishedRun(conversation.messages),
    contentLocked: conversation.contentLocked === true,
    temporary: conversation.temporary === true,
  }
  const previous = cache.byId.get(conversation.id)
  const row = previous && sameRow(previous, built) ? previous : built
  cache.byConversation.set(conversation, row)
  cache.byId.set(conversation.id, row)
  return row
}

/**
 * The current user's sessions in the active project context, newest first.
 * Legacy sessions without a projectId fail open (always visible) so users
 * never lose sight of pre-scoping history.
 *
 * `projectId` names the project when the caller knows it better than the chat
 * store does: the rail lists a project's chats on every page of it, where the
 * store's project is whichever chat was open last.
 */
export function useSessionRows(projectId?: string | null): SessionRow[] {
  const cache = useRef<RowCache>({ byConversation: new WeakMap(), byId: new Map() })
  return useChatStore(
    useShallow((s) => {
      if (!s.currentUserId) return []
      const scope = projectId === undefined ? s.projectId : projectId
      return (
        s.conversations
          // A per-fire job conversation is a job's output, not a chat this person started (`isHiddenJobConversation`,
          // as `getUserConversations` applies it): the rows dropped this filter and listed every weekly run.
          .filter((c) => c.userId === s.currentUserId && conversationMatchesProject(c, scope) && !isHiddenJobConversation(c))
          // The store keeps creation order; sort newest-first so date groups
          // and rows in the sessions panel come out most-recently-updated first.
          .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
          .map((c) => rowFor(c, cache.current))
      )
    })
  )
}
