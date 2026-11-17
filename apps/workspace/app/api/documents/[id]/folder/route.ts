import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { moveDocumentSchema } from '@/lib/documents/document-wire'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'

type Params = { id: string }

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { folderId } = await parseJsonBody(request, moveDocumentSchema)
    const result = await moveDocumentToFolder({ documentId: params.id, folderId }, session)
    if (!result.ok) throw new BadRequestError(result.error)
    return { ...result.document, pending: result.pending ?? false }
  },
  {
    authz: {
      enforcedBy:
        'moveDocumentToFolder (org scope; requireProjectAccess project:documents:write for a project document, canManageOfficeShelf for an Archiv document)',
    },
  }
)
