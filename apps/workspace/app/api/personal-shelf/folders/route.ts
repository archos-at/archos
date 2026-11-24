import { apiRoute } from '@/lib/api/handler'
import { createFolderHandler, listFoldersHandler } from '@/lib/documents/folder-route-handlers'
import { createPersonalShelfFolder, listPersonalShelfFolders } from '@/lib/personal-shelf/folder-service'

export const GET = apiRoute(
  listFoldersHandler<unknown>((_params, session) => listPersonalShelfFolders(session)),
  { authz: { enforcedBy: 'listPersonalShelfFolders (requireShelfRead: the caller’s own shelf, personalShelf(session.userId))' } }
)

export const POST = apiRoute(
  createFolderHandler<unknown>((_params, session, input) => createPersonalShelfFolder(session, input)),
  {
    status: 201,
    authz: { enforcedBy: 'createPersonalShelfFolder (requireShelfWrite: the caller’s own shelf, personalShelf(session.userId))' },
  }
)
