import type { ProjectOutcome } from '@/lib/projects/project-status'
import type { Month } from '@/lib/projects/month'
import type { ProjectRecordView } from '@/lib/projects/project-record-types'
import { ApiRequestError } from './api-error'

export interface ClosingChoice {
  outcome: ProjectOutcome
  endedOn: Month
}

export type ProjectStatusChange =
  | { status: 'active' }
  | { status: 'paused' }
  | ({ status: 'closed' } & ClosingChoice)

export interface ProjectDeletion {
  purgeAfter?: string | null
}

export interface DeletionEntry {
  id: string
  entityType: string
  entityId: string
  displayName: string
  purgeAfter: string
  status: 'pending' | 'failed'
  lastError: string | null
}

export class ProjectRequestError extends ApiRequestError {
  readonly serverMessage: string | null

  constructor(message: string, status: number, serverMessage: string | null) {
    super(message, status)
    this.name = 'ProjectRequestError'
    this.serverMessage = serverMessage
  }
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

const projectPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`

const failure = async (response: Response, context: string): Promise<ProjectRequestError> => {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  const serverMessage = typeof body?.error === 'string' ? body.error : null
  return new ProjectRequestError(`${context}: ${response.status}`, response.status, serverMessage)
}

export const renameProject = async (projectId: string, name: string): Promise<void> => {
  const response = await fetch(projectPath(projectId), {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw await failure(response, 'Failed to rename project')
}

export const deleteProject = async (projectId: string, confirmName: string): Promise<ProjectDeletion> => {
  const response = await fetch(projectPath(projectId), {
    method: 'DELETE',
    headers: jsonHeaders,
    body: JSON.stringify({ confirmName }),
  })
  if (!response.ok) throw await failure(response, 'Failed to delete project')
  return ((await response.json().catch(() => null)) as ProjectDeletion | null) ?? {}
}

export const restoreProject = async (projectId: string): Promise<void> => {
  const response = await fetch(`${projectPath(projectId)}/restore`, { method: 'POST' })
  if (!response.ok) throw await failure(response, 'Failed to restore project')
}

export const reindexProject = async (projectId: string): Promise<void> => {
  const response = await fetch(`${projectPath(projectId)}/reindex`, { method: 'POST' })
  if (!response.ok) throw await failure(response, 'Failed to reindex project')
}

export const setProjectStatus = async (projectId: string, change: ProjectStatusChange): Promise<void> => {
  const response = await fetch(`${projectPath(projectId)}/status`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(change),
  })
  if (!response.ok) throw await failure(response, 'Failed to change project status')
}

export const getProjectRecord = async (projectId: string): Promise<Partial<ProjectRecordView>> => {
  const response = await fetch(`${projectPath(projectId)}/project-record`)
  if (!response.ok) throw await failure(response, 'Failed to load project record')
  return (await response.json()) as Partial<ProjectRecordView>
}

export const listDeletions = async (): Promise<DeletionEntry[]> => {
  const response = await fetch('/api/deletions')
  if (!response.ok) throw await failure(response, 'Failed to list deletions')
  return (await response.json()) as DeletionEntry[]
}
