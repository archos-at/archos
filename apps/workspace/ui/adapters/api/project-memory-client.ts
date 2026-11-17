import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import type { ProjectExperienceResult } from '@/lib/project-experience/types'
import { ApiRequestError } from './api-error'

export type ProjectMemoryEntry = Pick<
  ProjectMemoryItem,
  'id' | 'kind' | 'content' | 'status' | 'verification' | 'pinned' | 'provenanceType' | 'evidence'
>

export interface ProjectMemoryPage {
  items: ProjectMemoryEntry[]
  nextCursor: string | null
}

export interface ProjectMemoryUpdate {
  verification?: 'user_confirmed'
  status?: 'dismissed'
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

const memoryPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/memory`

const noteUrl = (projectId: string, item: { id: string; scope: string }): string =>
  item.scope === 'organization'
    ? `/api/organization/memory/${encodeURIComponent(item.id)}`
    : `${memoryPath(projectId)}/${encodeURIComponent(item.id)}`

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) })
  if (!response.ok) throw new ApiRequestError(`Failed to update project memory: ${response.status}`, response.status)
  return (await response.json()) as T
}

export const listProjectMemory = async (
  projectId: string,
  options: { limit: number; cursor?: string | null },
): Promise<ProjectMemoryPage> => {
  const query = new URLSearchParams({ limit: String(options.limit) })
  if (options.cursor) query.set('cursor', options.cursor)
  const response = await fetch(`${memoryPath(projectId)}?${query.toString()}`)
  if (!response.ok) throw new ApiRequestError(`Failed to list project memory: ${response.status}`, response.status)
  return (await response.json()) as ProjectMemoryPage
}

export const updateProjectMemoryItem = async (
  projectId: string,
  itemId: string,
  update: ProjectMemoryUpdate,
): Promise<{ item: ProjectMemoryEntry }> => {
  const response = await fetch(`${memoryPath(projectId)}/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(update),
  })
  if (!response.ok) throw new ApiRequestError(`Failed to update project memory: ${response.status}`, response.status)
  return (await response.json()) as { item: ProjectMemoryEntry }
}

export const addProjectMemoryItem = async (
  projectId: string,
  input: { kind: 'decision'; content: string },
): Promise<{ item: ProjectMemoryEntry }> => {
  const response = await fetch(memoryPath(projectId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new ApiRequestError(`Failed to add project memory: ${response.status}`, response.status)
  return (await response.json()) as { item: ProjectMemoryEntry }
}

export const renameProjectMemoryTopic = (
  projectId: string,
  input: { from: string | null; to: string | null },
): Promise<{ moved: number }> => patchJson<{ moved: number }>(`${memoryPath(projectId)}/topics`, input)

export const moveProjectMemoryNote = (
  projectId: string,
  item: { id: string; scope: string },
  topic: string | null,
): Promise<{ item: unknown }> => patchJson<{ item: unknown }>(noteUrl(projectId, item), { topic })

export const extractProjectExperience = async (projectId: string): Promise<ProjectExperienceResult> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/experience`, { method: 'POST' })
  if (!response.ok) throw new ApiRequestError(`Failed to extract project experience: ${response.status}`, response.status)
  return (await response.json()) as ProjectExperienceResult
}
