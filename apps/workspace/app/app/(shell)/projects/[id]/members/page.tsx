import { redirect } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveProjectSettingsAccess } from '@/lib/projects/settings-access'

interface ProjectMembersPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectMembersPage({
  params,
}: ProjectMembersPageProps): Promise<never> {
  const { id } = await params
  const target = await withPageSession(async (session) => {
    await requireProjectAccess(session, id, 'project:view')
    const access = await resolveProjectSettingsAccess(session, id)
    return access.manageMembers ? 'settings/members' : 'settings'
  })
  redirect(`/app/projects/${encodeURIComponent(id)}/${target}`)
}
