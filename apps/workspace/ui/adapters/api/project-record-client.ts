import type { Month } from '@/lib/projects/month'
import { ApiRequestError } from './api-error'

export interface ProjectPersonInput {
  name: string
  function: string
  company: string
  startedOn: Month | null
  endedOn: Month | null
  userId: string | null
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

const recordPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/project-record`

const peoplePath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/people`

const failure = (context: string, status: number): ApiRequestError =>
  new ApiRequestError(`${context}: ${status}`, status)

export const saveProjectStartMonth = async (projectId: string, startedOn: Month | null): Promise<void> => {
  const response = await fetch(recordPath(projectId), {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ startedOn }),
  })
  if (!response.ok) throw failure('Failed to save the project period', response.status)
}

export const addProjectPerson = async (projectId: string, person: ProjectPersonInput): Promise<void> => {
  const response = await fetch(peoplePath(projectId), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(person),
  })
  if (!response.ok) throw failure('Failed to add a person', response.status)
}

export const updateProjectPerson = async (
  projectId: string,
  personId: string,
  person: ProjectPersonInput,
): Promise<void> => {
  const response = await fetch(`${peoplePath(projectId)}/${encodeURIComponent(personId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(person),
  })
  if (!response.ok) throw failure('Failed to update a person', response.status)
}

export const removeProjectPerson = async (projectId: string, personId: string): Promise<void> => {
  const response = await fetch(`${peoplePath(projectId)}/${encodeURIComponent(personId)}`, { method: 'DELETE' })
  if (!response.ok) throw failure('Failed to remove a person', response.status)
}
