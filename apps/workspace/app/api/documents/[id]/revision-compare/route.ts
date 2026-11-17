import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { compareRevisionVisually } from '@/lib/documents/revision-compare-service'
import { revisionCompareBodySchema } from '@/lib/documents/revision-compare-types'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, request, params }) => {
    const { older, page } = await parseJsonBody(request, revisionCompareBodySchema)
    return compareRevisionVisually(session, params.id, older, page)
  },
  {
    authz: {
      enforcedBy:
        'compareRevisionVisually -> getAccessibleDocument x2 (read: project:view / org Archiv member, folder visibility), then hasPassedScreening x2 (not held), same collection',
    },
  },
)
