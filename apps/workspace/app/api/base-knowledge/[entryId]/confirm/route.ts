/**
 * Confirm a proposed base-knowledge entry, with any corrections (ADR-0158).
 * From now on it reaches the office's answers; the confirmation is its first
 * check. A licensed copy needs the office's licence attestation. Needs
 * org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { confirmBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { confirmEntryBodySchema } from '@/lib/base-knowledge/wire'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => confirmBaseKnowledge(session, params.entryId, await parseJsonBody(request, confirmEntryBodySchema)),
  { authz: { enforcedBy: 'confirmBaseKnowledge (canManageOfficeShelf)' } }
)
