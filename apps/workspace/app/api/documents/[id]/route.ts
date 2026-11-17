import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { deleteDocument, renameDocument } from '@/lib/documents/document-edits'
import { getListedDocument } from '@/lib/documents/listed-document'
import { toDocumentWireRows } from '@/lib/documents/list-projection'
import { renameDocumentSchema } from '@/lib/documents/document-wire'
import { documentMailOrigins } from '@/lib/mail-thread/mail-origins'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const listed = await getListedDocument(session, params.id)
    const [[document], mailOrigins] = await Promise.all([
      toDocumentWireRows(session.organizationId, [listed]),
      documentMailOrigins(session, { id: listed.id, projectId: listed.projectId }),
    ])
    return { document: { ...document, projectId: listed.projectId, ...(mailOrigins.length > 0 ? { mailOrigins } : {}) } }
  },
  {
    authz: {
      enforcedBy:
        'getListedDocument -> getAccessibleDocument (project:view | any member of the Archiv organization); ' +
        'mailOrigins only through threads the reader may read (documentMailOrigins)',
    },
  }
)

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { displayName } = await parseJsonBody(request, renameDocumentSchema)
    return renameDocument(session, params.id, displayName, request)
  },
  { authz: { enforcedBy: 'renameDocument -> getAccessibleDocument (project:documents:write | org:office_shelf:manage)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    await deleteDocument(session, params.id, request)
    return null
  },
  { authz: { enforcedBy: 'deleteDocument (requireFolderWrite project:documents:write | deleteOfficeShelfDocument canManageOfficeShelf)' } }
)
