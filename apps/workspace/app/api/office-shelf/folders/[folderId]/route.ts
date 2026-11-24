import { apiRoute } from '@/lib/api/handler'
import { deleteFolderHandler, updateFolderHandler } from '@/lib/documents/folder-route-handlers'
import { deleteOfficeShelfFolder, updateOfficeShelfFolder, type OfficeShelfFolderDeletion } from '@/lib/office-shelf/folder-service'

type Params = { folderId: string }

export const PATCH = apiRoute<Params>(
  updateFolderHandler<Params>(
    (params, session, patch) => updateOfficeShelfFolder(session, { folderId: params.folderId, ...patch }),
  ),
  { authz: { enforcedBy: 'updateOfficeShelfFolder (canManageOfficeShelf)' } }
)

export const DELETE = apiRoute<Params>(
  deleteFolderHandler<Params, OfficeShelfFolderDeletion>((params, session, request) =>
    deleteOfficeShelfFolder(session, params.folderId, request),
  ),
  {
    authz: {
      enforcedBy:
        'deleteOfficeShelfFolder (canManageOfficeShelf): moveFolderToBin, which refuses a legal hold and a norm; a Thema of Normen & Richtlinien re-files',
    },
  }
)
