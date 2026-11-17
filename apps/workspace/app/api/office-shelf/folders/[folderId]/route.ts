import { apiRoute } from '@/lib/api/handler'
import { deleteFolderHandler, updateFolderHandler } from '@/lib/documents/folder-route-handlers'
import { deleteOfficeShelfFolder, updateOfficeShelfFolder } from '@/lib/office-shelf/folder-service'

type Params = { folderId: string }

export const PATCH = apiRoute<Params>(
  updateFolderHandler<Params>(
    (params, session, patch) => updateOfficeShelfFolder(session, { folderId: params.folderId, ...patch }),
  ),
  { authz: { enforcedBy: 'updateOfficeShelfFolder (canManageOfficeShelf)' } }
)

export const DELETE = apiRoute<Params>(
  deleteFolderHandler<Params>((params, session) => deleteOfficeShelfFolder(session, params.folderId)),
  { authz: { enforcedBy: 'deleteOfficeShelfFolder (canManageOfficeShelf)' } }
)
