import 'server-only'
import type { Locale } from '@/i18n/config'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireMayRememberFrom } from '@/lib/conversations/cross-project-use'
import { requireMayLeaveConversation } from '@/lib/conversations/restricted-egress'
import { requireConversationKeepsMemory } from '@/lib/conversations/temporary'
import { requireResourceAccess } from '@/lib/sharing/access'
import { patchProjectProfile } from '@/lib/project-profile/profile-service'
import { addProjectMemoryItem, createOrganizationMemoryItem } from '@/lib/projects/service'
import type { MemoryPayload, ProjectProfilePayload, ProposedChangeResult } from './types'

export interface ApplyContext {
  session: AuthorizedSession
  projectId: string
  request: Request
  originConversationId: string | null
  locale: Locale
  memoryScope?: 'project'
  proposalId?: string
}

const NOTE_LABEL_WORDS = 12

export function noteLabel(content: string): string {
  const words = content.trim().split(/\s+/)
  return words.length > NOTE_LABEL_WORDS ? `${words.slice(0, NOTE_LABEL_WORDS).join(' ')} …` : words.join(' ')
}

export async function applyMemory(payload: MemoryPayload, context: ApplyContext): Promise<ProposedChangeResult[]> {
  const { session, projectId, originConversationId } = context
  await requireMayRememberFrom(originConversationId, session.organizationId)
  if (originConversationId) {
    await requireResourceAccess(session, 'conversation', originConversationId, 'viewer')
    await requireConversationKeepsMemory(originConversationId, session.organizationId)
    await requireMayLeaveConversation({ conversationId: originConversationId, locale: context.locale }, session.organizationId, 'memory')
  }
  const input = {
    kind: payload.kind,
    content: payload.content,
    confidence: payload.confidence,
    sourceConversationId: originConversationId,
    topic: payload.topic,
  }
  const options = { supersedesContent: payload.supersedes ?? null }
  const scope = context.memoryScope ?? payload.scope
  const item =
    scope === 'project'
      ? await addProjectMemoryItem(session, projectId, input, options)
      : await createOrganizationMemoryItem(session, input, options)
  return [{ label: noteLabel(payload.content), ok: true, itemId: item.id, scope }]
}

export async function applyProjectProfile(
  payload: ProjectProfilePayload,
  context: ApplyContext
): Promise<ProposedChangeResult[]> {
  const { session, projectId, originConversationId, locale } = context
  const origin = originConversationId ? { conversationId: originConversationId, locale } : undefined
  const label = payload.title
  try {
    await patchProjectProfile(session, projectId, payload.patch, origin)
    return [{ label, ok: true }]
  } catch (error) {
    if (error instanceof ConflictError || error instanceof BadRequestError) {
      return [{ label, ok: false, reason: error.message }]
    }
    throw error
  }
}
