import { apiRoute } from '@/lib/api/handler'
import { removeProjectRoleAssignment } from '@/lib/projects/members-service'

export const DELETE = apiRoute<{ id: string; assignmentId: string }>(
  async ({ session, params, request }) => {
    await removeProjectRoleAssignment(session, params.id, params.assignmentId, request)
  },
  {
    authz: {
      enforcedBy: 'removeProjectRoleAssignment (requireProjectAccess project:members:manage)',
    },
  }
)
