import { z } from 'zod'
import { collectPages } from '@/lib/api/offset-page'
import { ApiRequestError } from './api-error'

const ProjectMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  role: z.string().nullable(),
})

export type ProjectMember = z.infer<typeof ProjectMemberSchema>

const ProjectMembersPageSchema = z.object({
  members: z.array(ProjectMemberSchema),
  nextCursor: z.string().nullish(),
})

export const listProjectMembers = async (projectId: string): Promise<ProjectMember[]> =>
  collectPages(async (cursor) => {
    const query = new URLSearchParams({ limit: '200' })
    if (cursor) query.set('cursor', cursor)
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members?${query}`)
    if (!response.ok) throw new ApiRequestError(`Failed to load the project members: ${response.status}`, response.status)
    const page = ProjectMembersPageSchema.parse(await response.json())
    return { items: page.members, nextCursor: page.nextCursor }
  })
