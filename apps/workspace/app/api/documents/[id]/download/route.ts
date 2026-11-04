/**
 * Document download API — presign a browser-facing download URL: the original,
 * or with `?format=pdf` the PDF rendition of an office file or a DXF drawing.
 * Thin handler; all logic lives in `@/lib/documents/document-delivery`.
 */

import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getDocumentDownload } from '@/lib/documents/document-delivery'
import { documentDownloadQuerySchema } from '@/lib/documents/document-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    getDocumentDownload(session, params.id, parseQuery(request, documentDownloadQuerySchema)),
  { authz: { enforcedBy: 'getDocumentDownload -> getAccessibleDocument (project:view)' } }
)
