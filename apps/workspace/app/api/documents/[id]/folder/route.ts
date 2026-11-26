import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { moveDocumentSchema } from '@/lib/documents/document-wire'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { NameConflictError } from '@/lib/documents/name-conflict'
import { assertMoveKeepsOutOfStandards } from '@/lib/office-shelf/service'

type Params = { id: string }

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { folderId, onConflict } = await parseJsonBody(request, moveDocumentSchema)
    await assertMoveKeepsOutOfStandards(session, params.id, folderId)
    const result = await moveDocumentToFolder({ documentId: params.id, folderId, onConflict }, session, { request })
    if (!result.ok) throw result.conflict ? new NameConflictError(result.conflict) : new BadRequestError(result.error)
    return {
      ...result.document,
      pending: result.pending ?? false,
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.replacedInto ? { replacedInto: result.replacedInto } : {}),
    }
  },
  {
    authz: {
      enforcedBy:
        'moveDocumentToFolder (org scope; requireProjectAccess project:documents:write for a project document, canManageOfficeShelf for an Archiv document)',
    },
  }
)
