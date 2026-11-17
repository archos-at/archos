import { isTaskThread } from '@/lib/tasks/task-thread'

export function conversationMatchesProject(
  conversation: { projectId?: string | null },
  activeProjectId: string | null | undefined,
): boolean {
  if (!activeProjectId) return true
  if (!conversation.projectId) return true
  return conversation.projectId === activeProjectId
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
