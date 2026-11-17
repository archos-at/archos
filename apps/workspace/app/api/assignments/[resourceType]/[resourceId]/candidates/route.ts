import { apiRoute, parseQuery } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { assignmentCandidatesQuerySchema } from '@/lib/assignments/assignment-wire'
import { listAssignmentCandidates } from '@/lib/assignments/service'
import { requireShareableType } from '@/lib/sharing/registry'

type Params = { resourceType: string; resourceId: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    const candidates = await listAssignmentCandidates(
      session,
      requireShareableType(params.resourceType),
      params.resourceId,
      { access: parseQuery(request, assignmentCandidatesQuerySchema).access ?? 'read' },
    )
    return { candidates }
  },
  { authz: { enforcedBy: 'listAssignmentCandidates (requireResourceAccess collaborator)' } },
)
