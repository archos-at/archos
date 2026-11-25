import { conversationMatchesProject, conversationsOnSide } from './project-scope'

export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000

export interface ResumableSession {
  id: string
  updatedAt: Date | string | number
  messages: readonly unknown[]
}

const timeOf = (value: Date | string | number): number => {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

export function resumableSessionId(
  sessions: readonly ResumableSession[],
  now: number = Date.now(),
  windowMs: number = RESUME_WINDOW_MS
): string | null {
  let newest: ResumableSession | null = null
  let newestAt = Number.NEGATIVE_INFINITY
  for (const session of sessions) {
    const at = timeOf(session.updatedAt)
    if (at > newestAt) {
      newestAt = at
      newest = session
    }
  }
  if (!newest || newest.messages.length === 0) return null

  const age = Math.max(0, now - newestAt)
  return age <= windowMs ? newest.id : null
}

export interface ArrivalConversation extends ResumableSession {
  userId: string
  projectId?: string | null
  jobId?: string | null
}

export interface ArrivalState {
  currentUserId: string | null
  currentConversation: { id: string; userId?: string | null; projectId?: string | null } | null
  conversations: readonly ArrivalConversation[]
}

export function openOnSide(
  state: Pick<ArrivalState, 'currentConversation' | 'currentUserId'>,
  side: string | null | undefined
): string | null {
  const open = state.currentConversation
  return open && open.userId === state.currentUserId && conversationMatchesProject(open, side) ? open.id : null
}

export function resumesUntil(state: ArrivalState, side: string | null, now: number = Date.now()): number | null {
  if (openOnSide(state, side)) return Number.POSITIVE_INFINITY
  const onSide = conversationsOnSide(state.conversations, state.currentUserId, side)
  const resumed = onSide.find((c) => c.id === resumableSessionId(onSide, now))
  return resumed ? timeOf(resumed.updatedAt) + RESUME_WINDOW_MS : null
}
