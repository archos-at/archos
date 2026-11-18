import { apiRoute, parseQuery } from '@/lib/api/handler'
import { decodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { uploadHistoryQuerySchema } from '@/lib/upload-batches/batch-wire'
import { listProjectUploadHistory } from '@/lib/upload-batches/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { cursor } = parseQuery(request, uploadHistoryQuerySchema)
    return listProjectUploadHistory(session, params.id, {
      cursor: cursor ? (decodeDocumentListCursor(cursor) ?? undefined) : undefined,
    })
  },
  { authz: { enforcedBy: 'listProjectUploadHistory -> requireProjectAccess (project:view)' } }
)
