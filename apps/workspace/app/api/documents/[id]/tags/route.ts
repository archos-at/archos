import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { updateDocumentTags } from '@/lib/documents/document-edits'
import { updateTagsSchema } from '@/lib/documents/document-wire'

type Params = { id: string }

export const PATCH = apiRoute<Params>(
  async ({ session, request, params }) => {
    const { tags, topics } = await parseJsonBody(request, updateTagsSchema)
    return updateDocumentTags(session, params.id, tags, topics)
  },
  { authz: { enforcedBy: 'updateDocumentTags -> getAccessibleDocument (project:documents:write)' } }
)
