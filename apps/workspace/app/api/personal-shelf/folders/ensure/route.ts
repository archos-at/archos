import { apiRoute } from '@/lib/api/handler'
import { ensureFoldersHandler } from '@/lib/documents/folder-route-handlers'
import { ensurePersonalShelfFolderPaths } from '@/lib/personal-shelf/folder-service'

export const POST = apiRoute(
  ensureFoldersHandler<unknown>((_params, session, input) => ensurePersonalShelfFolderPaths(session, input)),
  { authz: { enforcedBy: 'ensurePersonalShelfFolderPaths (requireShelfWrite: the caller’s own shelf, personalShelf(session.userId))' } }
)
