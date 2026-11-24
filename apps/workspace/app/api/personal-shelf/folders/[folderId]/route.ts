import { apiRoute } from '@/lib/api/handler'
import { deleteFolderHandler, updateFolderHandler } from '@/lib/documents/folder-route-handlers'
import { deletePersonalShelfFolder, updatePersonalShelfFolder } from '@/lib/personal-shelf/folder-service'

type Params = { folderId: string }

export const PATCH = apiRoute<Params>(
  updateFolderHandler<Params>(
    (params, session, patch) => updatePersonalShelfFolder(session, { folderId: params.folderId, ...patch }),
  ),
  { authz: { enforcedBy: 'updatePersonalShelfFolder (requireShelfWrite: the caller’s own shelf, personalShelf(session.userId))' } }
)

export const DELETE = apiRoute<Params>(
  deleteFolderHandler<Params>((params, session) => deletePersonalShelfFolder(session, params.folderId)),
  { authz: { enforcedBy: 'deletePersonalShelfFolder (requireShelfWrite: the caller’s own shelf, personalShelf(session.userId))' } }
)
