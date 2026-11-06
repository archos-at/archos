/**
 * Record that somebody checked a base-knowledge copy is still the edition in
 * force, and what they found (ADR-0158). Append-only: a check is never edited.
 * Needs org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { recordBaseKnowledgeCheck } from '@/lib/base-knowledge/office/service'
import { recordCheckBodySchema } from '@/lib/base-knowledge/wire'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => recordBaseKnowledgeCheck(session, params.entryId, await parseJsonBody(request, recordCheckBodySchema)),
  { authz: { enforcedBy: 'recordBaseKnowledgeCheck (canManageOfficeShelf)' }, status: 201 }
)
