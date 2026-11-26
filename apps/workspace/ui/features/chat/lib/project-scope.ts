import { isTaskThread } from '@/lib/tasks/task-thread'

export function conversationMatchesProject(
  conversation: { projectId?: string | null },
  activeProjectId: string | null | undefined,
): boolean {
  return (conversation.projectId ?? null) === (activeProjectId ?? null)
}

export function isJobConversation(conversation: { jobId?: string | null }): boolean {
  return Boolean(conversation.jobId)
}

export function isHiddenJobConversation(conversation: {
  id?: string | null
  jobId?: string | null
}): boolean {
  return isJobConversation(conversation) && !isTaskThread(conversation)
}

export function conversationsOnSide<
  T extends { id?: string | null; userId: string; projectId?: string | null; jobId?: string | null },
>(conversations: readonly T[], userId: string | null, side: string | null | undefined): T[] {
  if (!userId) return []
  return conversations.filter(
    (c) => c.userId === userId && conversationMatchesProject(c, side) && !isHiddenJobConversation(c),
  )
}
