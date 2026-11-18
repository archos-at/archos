import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { checkProjectConsistency } from '@/lib/project-profile/profile-service'
import { consistencyCheckSchema } from '@/lib/project-profile/profile-wire'

export const POST = apiRoute<{ id: string }>(
  async ({ session, params, request }) => {
    const input = await parseJsonBody(request, consistencyCheckSchema)
    return checkProjectConsistency(session, params.id, input)
  },
  { authz: { enforcedBy: 'checkProjectConsistency (requireProjectAccess project:edit)' } }
)
