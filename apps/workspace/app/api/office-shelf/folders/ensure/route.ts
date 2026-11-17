import { apiRoute } from '@/lib/api/handler'
import { ensureFoldersHandler } from '@/lib/documents/folder-route-handlers'
import { ensureOfficeShelfFolderPaths } from '@/lib/office-shelf/folder-service'

export const POST = apiRoute(
  ensureFoldersHandler<unknown>((_params, session, input) => ensureOfficeShelfFolderPaths(session, input)),
  { authz: { enforcedBy: 'ensureOfficeShelfFolderPaths (canManageOfficeShelf)' } }
)
