import { z } from 'zod'
import { ApiRequestError } from './api-error'
import { listProjectMembers } from './project-members-client'

const FolderPersonSchema = z.object({
  userId: z.string(),
  level: z.enum(['read', 'write']),
})

export type FolderPersonItem = z.infer<typeof FolderPersonSchema>

const FolderAccessSettingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }),
  z.object({ mode: z.literal('custom'), everyoneReads: z.boolean(), people: z.array(FolderPersonSchema) }),
])

export type FolderAccessSetting = z.infer<typeof FolderAccessSettingSchema>

const FolderAccessResultSchema = z.object({
  folderId: z.string(),
  access: FolderAccessSettingSchema,
  moved: z.number(),
  failed: z.array(z.string()),
})

export type FolderAccessResult = z.infer<typeof FolderAccessResultSchema>

const accessUrl = (projectId: string, folderId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/access`

async function failure(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return new ApiRequestError(typeof message === 'string' && message ? message : `${fallback}: ${response.status}`, response.status)
}

export async function getFolderAccess(projectId: string, folderId: string): Promise<FolderAccessSetting> {
  const response = await fetch(accessUrl(projectId, folderId))
  if (!response.ok) throw await failure(response, 'Failed to load folder access')
  return FolderAccessSettingSchema.parse(await response.json())
}

export async function setFolderAccess(
  projectId: string,
  folderId: string,
  access: FolderAccessSetting
): Promise<FolderAccessResult> {
  const response = await fetch(accessUrl(projectId, folderId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(access),
  })
  if (!response.ok) throw await failure(response, 'Failed to change folder access')
  return FolderAccessResultSchema.parse(await response.json())
}

export interface ProjectPerson {
  userId: string
  name: string
  email: string | null
}

export async function listProjectPeople(projectId: string): Promise<ProjectPerson[]> {
  const members = await listProjectMembers(projectId)
  return members
    .filter((member) => member.role !== null)
    .map(({ userId, name, email }) => ({ userId, name, email }))
}
