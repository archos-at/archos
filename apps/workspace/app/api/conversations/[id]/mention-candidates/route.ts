import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { listMentionCandidates } from '@/lib/mentions/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated
    return listMentionCandidates(session, params.id)
  },
  { authz: { enforcedBy: 'listMentionCandidates -> filterUsersWithProjectAccess' } }
)
