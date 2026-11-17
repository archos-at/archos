import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { documentThreadRequestSchema } from '@/lib/annotations/types'
import { ensureDocumentThread } from '@/lib/annotations/document-thread'
import { getAccessibleDocument } from '@/lib/documents/access'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, request, params }) => {
    const { title } = await parseJsonBody(request, documentThreadRequestSchema)
    const doc = await getAccessibleDocument(session, params.id, 'read')
    return { conversationId: await ensureDocumentThread(session, doc, title) }
  },
  {
    authz: {
      enforcedBy: 'getAccessibleDocument (read) + ensureDocumentThread -> requireProjectAccess (project:chat)',
    },
  }
)
