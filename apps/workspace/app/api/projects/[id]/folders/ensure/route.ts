import { apiRoute } from '@/lib/api/handler'
import { ensureFoldersHandler } from '@/lib/documents/folder-route-handlers'
import { ensureProjectFolderPaths } from '@/lib/projects/folder-service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  ensureFoldersHandler<Params>((params, session, input) =>
    ensureProjectFolderPaths({ projectId: params.id, ...input }, session)
  ),
  {
    authz: {
      enforcedBy: 'ensureProjectFolderPaths (requireProjectAccess project:documents:write)',
    },
  },
)
