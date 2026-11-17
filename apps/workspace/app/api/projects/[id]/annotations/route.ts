import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listProjectAnnotations } from '@/lib/annotations/project-marks'
import { projectMarksQuerySchema } from '@/lib/annotations/project-types'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    listProjectAnnotations(session, params.id, parseQuery(request, projectMarksQuerySchema)),
  {
    authz: {
      enforcedBy:
        'listProjectAnnotations (requireProjectAccess project:view; documents narrowed by getHiddenFolderIds and shelfReaderFor, canWriteDocument per document)',
    },
  }
)
