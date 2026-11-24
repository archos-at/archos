import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { UnauthorizedError } from '@/lib/api/errors'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { findProjectInOrg } from '@/lib/projects/repository'
import { FIRST_PLACE, LAST_PLACE_COOKIE, OVERVIEW_PARAM, landingPath, withOverview } from '@/components/shell/landing'
import { projectIdFromPathname } from '@/components/shell/org-sections'

export default async function AppIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const overview = (await searchParams)[OVERVIEW_PARAM]
  const go = (path: string): never => redirect(overview ? withOverview(path, overview === 'new') : path)
  const target = landingPath((await cookies()).get(LAST_PLACE_COOKIE)?.value)
  const projectId = projectIdFromPathname(target)
  if (projectId === null) return go(target)
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
  return go(reachable ? target : FIRST_PLACE)
}
