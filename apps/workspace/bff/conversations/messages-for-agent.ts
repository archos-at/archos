import 'server-only'

import { answerTextForAgent } from '@/lib/agent-asks/answer-text'
import { projectFactResolver } from '@/lib/project-profile/answer-bindings'
import { findProjectProfile } from '@/lib/projects/repository'
import { projectKeysIn, type ProjectKey } from '@/lib/text/answer-directives'
import { findConversationTenancy } from './repository'
import type { MessageListResponse } from './message-view'

export async function projectValuesFor(
  content: string,
  projectId: string | null,
  organizationId: string
): Promise<((key: ProjectKey) => string | null) | undefined> {
  if (!projectId || projectKeysIn(content).length === 0) return undefined
  const resolve = projectFactResolver(await findProjectProfile(projectId, organizationId))
  return (key) => resolve(key).text
}

export async function messagesForAgent(
  page: MessageListResponse,
  conversationId: string,
  organizationId: string
): Promise<MessageListResponse> {
  const answers = page.messages.filter((message) => message.role === 'assistant')
  if (answers.length === 0) return page
  const bound = answers.map((message) => message.content).join('\n')
  const projectId = projectKeysIn(bound).length > 0 ? ((await findConversationTenancy(conversationId))?.projectId ?? null) : null
  const projectValue = await projectValuesFor(bound, projectId, organizationId)
  return {
    ...page,
    messages: page.messages.map((message) =>
      message.role === 'assistant' ? { ...message, content: answerTextForAgent(message.content, { projectValue }) } : message
    ),
  }
}
