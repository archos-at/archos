import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { getProjectProfile, saveProjectProfile } from '@/lib/project-profile/profile-service'
import { toProfileWire } from '@/lib/project-profile/profile-wire'
import { ProjectProfileSchema } from '@/lib/project-profile/types'

type Params = { id: string }

function parseIfMatchVersion(header: string | null): number | undefined {
  if (header === null) return undefined
  const raw = header.trim().replace(/^"(.*)"$/, '$1')
  const version = Number(raw)
  if (!Number.isInteger(version) || version < 0) {
    throw new BadRequestError('Invalid If-Match header: expected a profile version number.')
  }
  return version
}

export const GET = apiRoute<Params>(
  async ({ session, params }) => toProfileWire(await getProjectProfile(session, params.id)),
  { authz: { enforcedBy: 'getProjectProfile (requireProjectAccess project:view)' } }
)

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) => {
    const profile = await parseJsonBody(request, ProjectProfileSchema)
    const expectedVersion = parseIfMatchVersion(request.headers.get('if-match'))
    return toProfileWire(await saveProjectProfile(session, params.id, profile, expectedVersion))
  },
  { authz: { enforcedBy: 'saveProjectProfile (requireProjectAccess project:edit)' } }
)
