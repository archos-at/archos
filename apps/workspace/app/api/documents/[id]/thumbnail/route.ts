import { apiRoute } from '@/lib/api/handler'
import { refuseLicensedFileForAgent } from '@/lib/base-knowledge/door-guard'
import { getDocumentThumbnail } from '@/lib/documents/document-delivery'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    await refuseLicensedFileForAgent(session, params.id)
    return getDocumentThumbnail(session, params.id)
  },
  { authz: { enforcedBy: 'getDocumentThumbnail -> getAccessibleDocument (project:view)' } }
)
