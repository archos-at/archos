/**
 * Record that somebody checked a base-knowledge copy is still the edition in
 * force, and what they found (ADR-0158). Append-only: a check is never edited.
 * Needs org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { onceForKey } from '@/lib/base-knowledge/http/idempotency'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { recordBaseKnowledgeCheck } from '@/lib/base-knowledge/office/service'
import { recordCheckBodySchema } from '@/lib/base-knowledge/wire'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const body = await parseJsonBody(request, recordCheckBodySchema)
      const operation = `base-knowledge-check-record:${params.entryId}`
      return onceForKey({ request, organizationId: session.organizationId, operation, body }, () =>
        recordBaseKnowledgeCheck(session, params.entryId, body),
      )
    }),
  { authz: { enforcedBy: 'recordBaseKnowledgeCheck (canManageOfficeShelf)' }, status: 201 }
)
