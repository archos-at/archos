import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { roomPeerOf } from '@/lib/annotations/peer-header'
import { createAnnotation, listAnnotations } from '@/lib/annotations/service'
import { createAnnotationRequestSchema } from '@/lib/annotations/types'

type Params = { id: string }

export const GET = apiRoute<Params>(async ({ session, params }) => listAnnotations(session, params.id), {
  authz: { enforcedBy: 'listAnnotations -> getAccessibleDocument (read)' },
})

export const POST = apiRoute<Params>(
  async ({ session, request, params }) =>
    createAnnotation(session, params.id, await parseJsonBody(request, createAnnotationRequestSchema), {
      kind: 'person',
      peerId: roomPeerOf(request),
    }),
  {
    authz: { enforcedBy: 'createAnnotation -> getAccessibleDocument (project:documents:write)' },
    status: 201,
  }
)
