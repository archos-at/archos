import type { DirectoryPerson } from '@/lib/sharing/types'

export type AssignmentFetch = (path: string, init?: RequestInit) => Promise<Response>

export interface AssigneeView extends DirectoryPerson {
  assignedBy?: string
}

const defaultFetch: AssignmentFetch = (path, init) => fetch(path, init)

const resourcePath = (resourceType: string, resourceId: string) =>
  `/api/assignments/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`

async function assignees(response: Response): Promise<AssigneeView[]> {
  if (!response.ok) throw new Error(`assignments ${response.status}`)
  const body = (await response.json()) as { assignees?: AssigneeView[] }
  return body.assignees ?? []
}

export async function listAssignees(
  resourceType: string,
  resourceId: string,
  run: AssignmentFetch = defaultFetch
): Promise<AssigneeView[]> {
  return assignees(await run(resourcePath(resourceType, resourceId)))
}

export async function assignPerson(
  resourceType: string,
  resourceId: string,
  userId: string,
  run: AssignmentFetch = defaultFetch
): Promise<AssigneeView[]> {
  return assignees(
    await run(resourcePath(resourceType, resourceId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
  )
}

export async function releasePerson(
  resourceType: string,
  resourceId: string,
  userId: string,
  run: AssignmentFetch = defaultFetch
): Promise<AssigneeView[]> {
  return assignees(
    await run(`${resourcePath(resourceType, resourceId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' })
  )
}

export async function listAssignmentCandidates(
  resourceType: string,
  resourceId: string,
  options: { access?: 'read' | 'write' } = {},
  run: AssignmentFetch = defaultFetch
): Promise<DirectoryPerson[]> {
  const query = options.access === 'write' ? '?access=write' : ''
  const response = await run(`${resourcePath(resourceType, resourceId)}/candidates${query}`)
  if (!response.ok) throw new Error(`candidates ${response.status}`)
  const body = (await response.json()) as { candidates?: DirectoryPerson[] }
  return body.candidates ?? []
}
