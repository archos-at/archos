import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { measureOnDocument } from '@/lib/drawing-tape/service'
import { measureRequestSchema } from '@/lib/drawing-tape/wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, request, params }) =>
    measureOnDocument(session, params.id, await parseJsonBody(request, measureRequestSchema)),
  { authz: { enforcedBy: 'measureOnDocument -> drawing-measure entitlement, getAccessibleDocument (read)' } }
)
