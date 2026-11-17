import { apiRoute } from '@/lib/api/handler'
import { createFolderHandler, listFoldersHandler } from '@/lib/documents/folder-route-handlers'
import { createOfficeShelfFolder, listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'

export const GET = apiRoute(
  listFoldersHandler<unknown>((_params, session) => listOfficeShelfFolders(session)),
  {
    authz: {
      sessionOnly: true,
      why: 'the Archiv is org-wide shared knowledge; listOfficeShelfFolders scopes to session.organizationId and any member may read it, like listOfficeShelf',
    },
  }
)

export const POST = apiRoute(
  createFolderHandler<unknown>((_params, session, input) => createOfficeShelfFolder(session, input)),
  {
    status: 201,
    authz: { enforcedBy: 'createOfficeShelfFolder (canManageOfficeShelf)' },
  }
)
