import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { archiveDocument } from '@/lib/documents/version-content'
import { archiveRequestSchema } from '@/lib/documents/lifecycle-types'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    await parseJsonBody(request, archiveRequestSchema)
    return archiveDocument(session, params.id, request)
  },
  { authz: { enforcedBy: 'archiveDocument -> getAccessibleDocument + requireProjectAccess (project:documents:write | project:edit)' } }
)
