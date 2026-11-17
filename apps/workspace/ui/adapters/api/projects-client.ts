import { ApiRequestError } from './api-error'

export interface ProjectListItem {
  id: string
  name: string
}

const PROJECTS_PATH = '/api/projects'

export const listProjects = async (options: { signal?: AbortSignal } = {}): Promise<ProjectListItem[]> => {
  const response = await fetch(PROJECTS_PATH, { signal: options.signal })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to list projects: ${response.status}`, response.status)
  }
  return (await response.json()) as ProjectListItem[]
}

export interface ProjectCollection {
  collectionName?: string
}

export const getProjectCollection = async (projectId: string): Promise<ProjectCollection> => {
  const response = await fetch(`${PROJECTS_PATH}/${encodeURIComponent(projectId)}`)
  if (!response.ok) {
    throw new ApiRequestError(`Failed to load project: ${response.status}`, response.status)
  }
  return (await response.json()) as ProjectCollection
}
