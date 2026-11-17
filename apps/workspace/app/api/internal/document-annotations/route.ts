import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { resolveAgentDocument, runAgentAnnotationRequest } from '@/lib/annotations/agent'
import { internalAnnotationRequestSchema } from '@/lib/annotations/types'
import { withTenant } from '@/lib/db/tenant-context'

export const POST = internalApiRoute(
  'document-annotations',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, internalAnnotationRequestSchema)
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId }, async () => {
      const document = await resolveAgentDocument(context, body.documentId ?? null, body.answerMessageId ?? null)
      return runAgentAnnotationRequest(session, document, body, {
        organizationId: context.organizationId,
        conversationId: context.conversationId ?? '',
        onBehalfOf: context.userId,
      })
    })
  },
  { tenancy: { fromPayload: 'the signed request-context envelope' } }
)
