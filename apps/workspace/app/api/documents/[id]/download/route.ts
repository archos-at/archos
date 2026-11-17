import { apiRoute, parseQuery } from '@/lib/api/handler'
import { refuseLicensedFileForAgent } from '@/lib/base-knowledge/door-guard'
import { getDocumentDownload } from '@/lib/documents/document-delivery'
import { documentDownloadQuerySchema } from '@/lib/documents/document-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    await refuseLicensedFileForAgent(session, params.id)
    return getDocumentDownload(session, params.id, parseQuery(request, documentDownloadQuerySchema))
  },
  { authz: { enforcedBy: 'getDocumentDownload -> getAccessibleDocument (project:view)' } }
)
