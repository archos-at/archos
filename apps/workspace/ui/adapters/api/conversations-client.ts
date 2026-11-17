import type { Conversation } from '@/lib/db/schema/conversations'
import type { Message } from '@/lib/db/schema/messages'
import { fetchThreadHistory } from '@/lib/conversations/history-client'
import type { MessageView } from '@/lib/conversations/message-view'
import { ApiRequestError } from './api-error'

export interface ConversationSummary {
  id: string
  title: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface ConversationTitleMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ConversationTitleResult {
  title: string
  tags: string[]
  error?: string
}

export type ListedConversation = Conversation & { contentLocked?: boolean }

export interface RestrictingOtherProject {
  id: string
  name: string | null
}

export class ConversationRightsLostError extends Error {
  constructor() {
    super('You no longer have the rights to view this conversation.')
    this.name = 'ConversationRightsLostError'
  }
}

async function throwIfRightsLost(res: Response): Promise<void> {
  if (res.status !== 403) return
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown } | null
  if (body?.code === 'RESOURCE_RIGHTS_LOST') throw new ConversationRightsLostError()
}

export const conversationsClient = {
  async list(projectId?: string): Promise<ListedConversation[]> {
    const params = new URLSearchParams({ limit: '200' })
    if (projectId) params.set('projectId', projectId)
    const res = await fetch(`/api/conversations?${params.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch conversations')
    return ((await res.json()) as { conversations: ListedConversation[] }).conversations
  },

  async get(id: string): Promise<Conversation> {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`)
    await throwIfRightsLost(res)
    if (!res.ok) throw new Error('Conversation not found')
    return res.json()
  },

  async restrictingOtherProjects(id: string): Promise<RestrictingOtherProject[] | null> {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!res.ok) return null
      const body = (await res.json()) as { restrictingOtherProjects?: unknown }
      if (!Array.isArray(body.restrictingOtherProjects)) return []
      return body.restrictingOtherProjects.flatMap((entry: unknown) => {
        const project = entry as { id?: unknown; name?: unknown } | null
        if (typeof project?.id !== 'string') return []
        return [{ id: project.id, name: typeof project.name === 'string' ? project.name : null }]
      })
    } catch {
      return null
    }
  },

  async newestFrameAge(id: string): Promise<number | null | undefined> {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/frames?peek=1`, {
        cache: 'no-store',
      })
      if (!res.ok) return undefined
      const body = (await res.json()) as { available?: unknown; newest?: unknown; now?: unknown }
      if (body.available !== true || typeof body.now !== 'number') return undefined
      if (typeof body.newest !== 'string') return null
      const ms = Number(body.newest.split('-')[0])
      return Number.isFinite(ms) ? Math.max(0, body.now - ms) : undefined
    } catch {
      return undefined
    }
  },

  async create(
    id: string,
    title?: string | null,
    projectId?: string | null,
    subject?: { resourceType: 'document'; resourceId: string } | null,
    temporary?: boolean,
  ): Promise<Conversation> {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title: title ?? null,
        projectId: projectId ?? null,
        subjectResourceType: subject?.resourceType ?? null,
        subjectResourceId: subject?.resourceId ?? null,
        ...(temporary ? { temporary: true } : {}),
      }),
    })
    if (!res.ok) throw new Error('Failed to create conversation')
    return res.json()
  },

  async setTemporary(id: string, temporary: boolean): Promise<Conversation> {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporary }),
    })
    if (!res.ok) throw new ApiRequestError(`Failed to set temporary: ${res.status}`, res.status)
    return res.json()
  },

  async updateTitle(id: string, title: string): Promise<Conversation> {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error('Failed to update conversation')
    return res.json()
  },

  async generateTitle(
    id: string,
    messages: ConversationTitleMessage[],
    locale?: string,
  ): Promise<ConversationTitleResult> {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, locale }),
    })
    if (!res.ok) throw new Error('Failed to generate conversation title')
    return res.json()
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete conversation')
  },

  async listMessages(conversationId: string): Promise<MessageView[]> {
    const history = await fetchThreadHistory(conversationId)
    if (!history.ok) {
      await throwIfRightsLost(history.response)
      throw new Error('Failed to fetch messages')
    }
    return history.messages
  },

  async createMessage(
    conversationId: string,
    message: { id: string; role: string; content: string; messageType?: string; metadata?: unknown; createdAt?: string },
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    )
    await throwIfRightsLost(res)
    if (!res.ok) throw new Error('Failed to create message')
    return res.json()
  },

  async createMessages(
    conversationId: string,
    messages: Array<{ id: string; role: string; content: string; messageType?: string; metadata?: unknown; createdAt?: string }>,
  ): Promise<Message[]> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      },
    )
    await throwIfRightsLost(res)
    if (!res.ok) throw new Error('Failed to create messages')
    return res.json()
  },

  async updateMessageCardInteractions(
    conversationId: string,
    messageId: string,
    cardInteractions: Record<string, { decision: string; decidedAt: string }>,
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardInteractions }),
      },
    )
    if (!res.ok) throw new Error('Failed to update message card interactions')
    return res.json()
  },

  async updateMessageProvenance(
    conversationId: string,
    messageId: string,
    provenance: Record<string, unknown>,
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provenance }),
      },
    )
    if (!res.ok) throw new Error('Failed to update message provenance')
    return res.json()
  },

  async updateMessageStages(
    conversationId: string,
    messageId: string,
    stages: Record<string, unknown>,
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages }),
      },
    )
    if (!res.ok) throw new Error('Failed to update message stages')
    return res.json()
  },

  async updateMessagePromptState(
    conversationId: string,
    messageId: string,
    promptState: { response: string },
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptState }),
      },
    )
    if (!res.ok) throw new Error('Failed to update message prompt state')
    return res.json()
  },

  async cutStoppedAnswer(
    conversationId: string,
    messageId: string,
    body: { turnId: string; shown: string },
  ): Promise<Message> {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/stopped`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) throw new Error('Failed to cut the stopped answer')
    return res.json()
  },
}

export type ConversationsClient = typeof conversationsClient
