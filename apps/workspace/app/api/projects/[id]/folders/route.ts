import { apiRoute, parseQuery } from '@/lib/api/handler'
import { createFolderHandler } from '@/lib/documents/folder-route-handlers'
import { folderListQuerySchema } from '@/lib/documents/folder-wire'
import { summarizeProjectDocuments } from '@/lib/documents/shelf-summary'
import { createProjectFolder, listProjectFolders, projectRootAccess } from '@/lib/projects/folder-service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { counts } = parseQuery(request, folderListQuerySchema)
    const [folders, rootAccess, summary] = await Promise.all([
      listProjectFolders(params.id, session),
      projectRootAccess(session, params.id),
      counts ? summarizeProjectDocuments(session, params.id) : null,
    ])
    if (!summary) return { folders, rootAccess }
    const total = new Map(summary.folders.map((tally) => [tally.folderId, tally.total]))
    return {
      folders: folders.map((folder) => ({ ...folder, documentCount: total.get(folder.id) ?? 0 })),
      rootAccess,
      rootDocumentCount: total.get(null) ?? 0,
    }
  },
  { authz: { enforcedBy: 'listProjectFolders (requireProjectAccess project:view; folder read access)' } }
)

export const POST = apiRoute<Params>(
  createFolderHandler<Params>((params, session, input) =>
    createProjectFolder({ projectId: params.id, ...input }, session)
  ),
  {
    status: 201,
    authz: { enforcedBy: 'createProjectFolder (requireFolderWrite: project:documents:write + write on the parent)' },
  }
)
