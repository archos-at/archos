import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { confirmProjectBase } from '@/lib/base-knowledge/context/operations'
import { projectBaseConfirmBodySchema } from '@/lib/base-knowledge/context/operations-wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => confirmProjectBase(session, params.id, await parseJsonBody(request, projectBaseConfirmBodySchema)),
  { authz: { enforcedBy: 'confirmProjectBase (requireProjectAccess project:edit, requirePersonDecision)' } },
)
