import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Conversation } from '@/lib/db/schema/conversations'
import { requireResourceAccess } from '@/lib/sharing/access'
import { CONVERSATION_TAG_KEYS, normalizeConversationTags } from './tags'
import { updateConversationMetaInOrg, updateConversationTitleInOrg } from './repository'
import { screenedInputs } from './message-screening'

const GENERATE_TITLE_TIMEOUT_MS = 35_000

export interface ConversationTitleMessageInput {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateConversationTitleResult {
  title: string
  tags: string[]
  error?: string
}

export async function updateConversationTitle(
  session: AuthorizedSession,
  conversationId: string,
  title: string
): Promise<Conversation> {
  await requireResourceAccess(session, 'conversation', conversationId, 'owner')

  const conversation = await updateConversationTitleInOrg(
    conversationId,
    session.organizationId,
    title
  )
  if (!conversation) throw new NotFoundError()
  return conversation
}

export async function generateConversationTitle(
  session: AuthorizedSession,
  conversationId: string,
  input: { messages: ConversationTitleMessageInput[]; locale?: string }
): Promise<GenerateConversationTitleResult> {
  await requireResourceAccess(session, 'conversation', conversationId, 'owner')

  const messages = (
    await screenedInputs(
      session.organizationId,
      input.messages.map((m) => ({ role: m.role, content: (m.content ?? '').trim() })),
      { wholeText: true }
    )
  ).filter((m) => m.content.length > 0)
  if (messages.length === 0) {
    return { title: '', tags: [] }
  }

  let backendRes: Response
  try {
    backendRes = await fetch(`${getBackendUrl()}/v1/generate-conversation-title`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': session.organizationId,
      },
      body: JSON.stringify({
        messages,
        allowed_tags: CONVERSATION_TAG_KEYS,
        locale: input.locale ?? 'de',
      }),
      signal: AbortSignal.timeout(GENERATE_TITLE_TIMEOUT_MS),
    })
  } catch (e) {
    console.warn('[GenerateConversationTitle] Backend unreachable (non-fatal):', e)
    return { title: '', tags: [], error: 'backend_unreachable' }
  }

  if (!backendRes.ok) {
    const errorText = await backendRes.text().catch(() => '')
    console.error('[GenerateConversationTitle] Backend error:', backendRes.status, errorText)
    return { title: '', tags: [], error: 'backend_error' }
  }

  const { title, tags, error } = (await backendRes.json()) as {
    title: string
    tags?: string[]
    error?: string | null
  }

  if (error) {
    console.warn('[GenerateConversationTitle] Generation failed (non-fatal):', error)
    return { title: '', tags: [], error }
  }

  const cleanTitle = (title ?? '').trim()
  const cleanTags = normalizeConversationTags(tags ?? [])

  if (cleanTitle) {
    await updateConversationMetaInOrg(conversationId, session.organizationId, {
      title: cleanTitle,
      tags: cleanTags,
    })
  }

  return { title: cleanTitle, tags: cleanTags }
}
