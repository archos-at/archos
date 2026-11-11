/**
 * The person's tape on a PDF drawing (ADR-0182, slice 8).
 *
 * POST measures a distance, a path or an area between points on a page of the
 * document's current version, or says where the engine snaps those points. The
 * answer is the engine's, as data. A thin handler: the entitlement, the access
 * and the call to the engine live in `@/lib/drawing-tape/service`; the typed
 * client is `@/lib/drawing-tape/client`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { measureOnDocument } from '@/lib/drawing-tape/service'
import { measureRequestSchema } from '@/lib/drawing-tape/wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, request, params }) =>
    measureOnDocument(session, params.id, await parseJsonBody(request, measureRequestSchema)),
  {
    authz: {
      enforcedBy: 'measureOnDocument -> isDrawingMeasureEnabled (drawing-measure), getAccessibleDocument (read)',
    },
  }
)
