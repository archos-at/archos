import { apiRoute } from '@/lib/api/handler'
import { getAccessibleDocument } from '@/lib/documents/access'
import { listReviewCandidates } from '@/lib/documents/reviewers'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const document = await getAccessibleDocument(session, params.id, 'read')
    return { candidates: await listReviewCandidates(session, document) }
  },
  {
    authz: {
      enforcedBy:
        'getAccessibleDocument (project:view | org membership | conversation viewer); the list itself is filtered to project:edit holders',
    },
  },
)
