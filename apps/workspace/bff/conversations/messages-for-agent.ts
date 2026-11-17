import 'server-only'
/**
 * A conversation's messages as an agent reads them over the door (ADR-0122).
 *
 * A stored answer is written in the chat's dialect: `[[card:N]]` placement
 * markers, `:::check` fences, `:project[key]` bindings and the verifier's German
 * labels. The chat renders that dialect from the message's own `cards` and the
 * project profile; an agent that reads the thread through
 * `conversation-message-list` renders none of it, so a marker reached it as a
 * literal `[[card:1]]` pointing at a card it was never handed. The ask
 * (`agent-ask-get`) already took its answer through `answerTextForAgent`; this
 * is the same projection for every assistant message of the list, so the two
 * ways an agent reads one answer give the same text. The browser reads the same
 * route as a person and keeps the dialect.
 */

import { answerTextForAgent } from '@/lib/agent-asks/answer-text'
import { projectFactResolver } from '@/lib/project-profile/answer-bindings'
import { findProjectProfile } from '@/lib/projects/repository'
import { projectKeysIn, type ProjectKey } from '@/lib/text/answer-directives'
import { findConversationTenancy } from './repository'
import type { MessageListResponse } from './message-view'

/**
 * The project's values for the `:project[key]` bindings an answer holds, or
 * undefined when it holds none (no profile read). A key the profile lacks
 * stays the key, as in the copy: a value is never invented.
 */
export async function projectValuesFor(
  content: string,
  projectId: string | null,
  organizationId: string
): Promise<((key: ProjectKey) => string | null) | undefined> {
  if (!projectId || projectKeysIn(content).length === 0) return undefined
  const resolve = projectFactResolver(await findProjectProfile(projectId, organizationId))
  return (key) => resolve(key).text
}

/** `page` with every assistant message's content as plain Markdown for another agent. */
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
