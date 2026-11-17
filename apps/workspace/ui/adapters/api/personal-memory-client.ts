import type { PersonalMemoryKind, PersonalMemoryProvenance } from '@/lib/personal-memory/vocabulary'
import { ApiRequestError } from './api-error'

export interface PersonalMemoryNote {
  id: string
  kind: PersonalMemoryKind
  content: string
  provenanceType: PersonalMemoryProvenance
  pinned: boolean
  topic: string | null
  sourceConversationId: string | null
  createdAt: string
  updatedAt: string
}

export interface PersonalMemoryPage {
  items: PersonalMemoryNote[]
  nextCursor: string | null
  topics: { name: string; count: number }[]
}

export interface PersonalMemoryCreate {
  kind: PersonalMemoryKind
  content: string
  pinned?: boolean
  topic?: string | null
}

export interface PersonalMemoryUpdate {
  kind?: PersonalMemoryKind
  content?: string
  pinned?: boolean
  topic?: string | null
}

const MEMORY_PATH = '/api/user/memory'
const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }
const notePath = (itemId: string): string => `${MEMORY_PATH}/${encodeURIComponent(itemId)}`

async function refusal(response: Response, what: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const details = (body as { details?: unknown } | null)?.details
  const record = details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : null
  const reason = typeof record?.reason === 'string' ? record.reason : null
  return new ApiRequestError(`Failed to ${what} personal memory: ${response.status}`, response.status, reason, record)
}

export const listPersonalMemory = async (
  options: { limit?: number; cursor?: string | null } = {},
): Promise<PersonalMemoryPage> => {
  const query = new URLSearchParams()
  if (options.limit) query.set('limit', String(options.limit))
  if (options.cursor) query.set('cursor', options.cursor)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const response = await fetch(`${MEMORY_PATH}${suffix}`)
  if (!response.ok) throw new ApiRequestError(`Failed to list personal memory: ${response.status}`, response.status)
  return (await response.json()) as PersonalMemoryPage
}

export const addPersonalMemoryNote = async (
  input: PersonalMemoryCreate,
): Promise<{ item: PersonalMemoryNote; created: boolean }> => {
  const response = await fetch(MEMORY_PATH, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
  if (!response.ok) throw await refusal(response, 'add')
  return (await response.json()) as { item: PersonalMemoryNote; created: boolean }
}

export const updatePersonalMemoryNote = async (
  itemId: string,
  update: PersonalMemoryUpdate,
): Promise<{ item: PersonalMemoryNote }> => {
  const response = await fetch(notePath(itemId), { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(update) })
  if (!response.ok) throw await refusal(response, 'update')
  return (await response.json()) as { item: PersonalMemoryNote }
}

export const clearPersonalMemory = async (): Promise<{ removed: number }> => {
  const response = await fetch(MEMORY_PATH, { method: 'DELETE' })
  if (!response.ok) throw new ApiRequestError(`Failed to clear personal memory: ${response.status}`, response.status)
  return (await response.json()) as { removed: number }
}

export const removePersonalMemoryNote = async (itemId: string): Promise<void> => {
  const response = await fetch(notePath(itemId), { method: 'DELETE' })
  if (!response.ok) throw new ApiRequestError(`Failed to remove personal memory: ${response.status}`, response.status)
}

export const renamePersonalMemoryTopic = async (input: {
  from: string | null
  to: string | null
}): Promise<{ moved: number }> => {
  const response = await fetch(`${MEMORY_PATH}/topics`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw await refusal(response, 'rename topic in')
  return (await response.json()) as { moved: number }
}

export const removePersonalMemoryTopic = async (name: string): Promise<{ removed: number }> => {
  const response = await fetch(`${MEMORY_PATH}/topics`, {
    method: 'DELETE',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw await refusal(response, 'remove topic from')
  return (await response.json()) as { removed: number }
}
