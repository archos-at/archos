import { apiRoute, parseQuery } from '@/lib/api/handler'
import { snapTargetsOfDocument } from '@/lib/drawing-tape/snap-targets'
import { snapTargetsQuerySchema } from '@/lib/drawing-tape/snap-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, request, params }) =>
    snapTargetsOfDocument(
      session,
      params.id,
      parseQuery(request, snapTargetsQuerySchema).page,
      request.headers.get('if-none-match')
    ),
  {
    authz: {
      enforcedBy:
        'snapTargetsOfDocument -> isDrawingMeasureEnabled (drawing-measure), getAccessibleDocument (read)',
    },
  }
)
