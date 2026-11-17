import { UnprocessableError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { requirePinnedSession, requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import { createProposal } from '@/lib/proposals/service'
import { internalProposalRequestSchema, type InternalProposalResponse } from '@/lib/proposals/types'

export const POST = internalApiRoute(
  'proposals',
  async ({ request }): Promise<InternalProposalResponse> => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, internalProposalRequestSchema)
    const projectId = context.projectId
    if (!projectId) {
      throw new UnprocessableError('This conversation is not in a project. Workspace changes are proposed in one.', {
        reason: 'no-project',
      })
    }
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId }, async () => {
      const row = await createProposal(session, {
        projectId,
        kind: body.kind,
        payload: body.payload,
        conversationId: context.conversationId,
        answerMessageId: body.answerMessageId ?? null,
        originCardIndex: body.originCardIndex ?? null,
      })
      return { id: row.id, status: row.status }
    })
  },
  { tenancy: { fromPayload: 'the signed request-context envelope' } },
)
