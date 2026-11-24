import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { UnauthorizedError } from '@/lib/api/errors'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { findProjectInOrg } from '@/lib/projects/repository'
import { FIRST_PLACE, LAST_PLACE_COOKIE, landingPath } from '@/components/shell/landing'
import { projectIdFromPathname } from '@/components/shell/org-sections'

export default async function AppIndexPage(): Promise<never> {
  const target = landingPath((await cookies()).get(LAST_PLACE_COOKIE)?.value)
  const projectId = projectIdFromPathname(target)
  if (projectId === null) redirect(target)
  const reachable = await withPageSession(async (session) => {
    try {
      await requireProjectAccess(session, projectId, 'project:view')
      return (await findProjectInOrg(projectId, session.organizationId)) !== null
    } catch {
      return false
    }
  }).catch((error: unknown) => {
    if (error instanceof UnauthorizedError) return false
    throw error
  })
  redirect(reachable ? target : FIRST_PLACE)
}
