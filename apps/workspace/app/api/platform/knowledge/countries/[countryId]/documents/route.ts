/**
 * Add a document to a country from its publisher's URL, in one call: into the
 * country's open draft change request (or a new one), with the work, edition
 * and manifestation it is the text of, and the PDF fetched by the platform.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { addPlatformDocument } from '@/lib/base-knowledge/platform/document-add'
import { addDocumentBodySchema } from '@/lib/base-knowledge/platform/document-add-wire'
import { countryIdSchema } from '@/lib/base-knowledge/platform/wire'

type Params = { countryId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () =>
      addPlatformDocument(
        session,
        countryIdSchema.parse(params.countryId),
        await parseJsonBody(request, addDocumentBodySchema),
        actingReaderIsAgent() ? 'agent' : 'person',
      ),
    ),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
