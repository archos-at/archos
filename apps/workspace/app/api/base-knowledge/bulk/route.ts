/**
 * One change to many base-knowledge entries (at most `MAX_BULK_ENTRIES`):
 * record a check, move them into a base-knowledge folder, or remove them.
 * Answers one result per entry; a refused entry does not stop the others.
 * Needs org:office_shelf:manage, checked in `@/lib/base-knowledge/office/bulk`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { bulkBaseKnowledge } from '@/lib/base-knowledge/office/bulk'
import { bulkEntriesBodySchema } from '@/lib/base-knowledge/wire'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => bulkBaseKnowledge(session, await parseJsonBody(request, bulkEntriesBodySchema), request)),
  { authz: { enforcedBy: 'bulkBaseKnowledge (canManageOfficeShelf)' } },
)
