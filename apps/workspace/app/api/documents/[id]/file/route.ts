import { apiRoute, parseQuery } from '@/lib/api/handler'
import { refuseLicensedFileForAgent } from '@/lib/base-knowledge/door-guard'
import { documentFileQuerySchema } from '@/lib/documents/document-wire'
import { streamDocumentFile } from '@/lib/documents/document-delivery'
import { streamVersionFile } from '@/lib/documents/version-content'

type Params = { id: string; versionId?: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const query = parseQuery(request, documentFileQuerySchema)
    await refuseLicensedFileForAgent(session, params.id)
    const versionId = params.versionId ?? query.versionId
    return versionId
      ? streamVersionFile(session, params.id, versionId, { download: query.download === '1' })
      : streamDocumentFile(session, params.id)
  },
  {
    authz: {
      enforcedBy:
        'streamDocumentFile | streamVersionFile -> getAccessibleDocument (project:view for project documents; ' +
        'org membership for office shelf documents; a version must belong to the document and be published or superseded)',
    },
  }
)
