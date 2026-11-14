/**
 * Attach a text to a manifestation of a draft change request from a URL
 * (ADR-0165, "Texts are attached in the request"): the PDF is fetched and read
 * by the public-source fetcher, on a host of the configured source, kept in
 * the base corpus where nobody reads it until the request is published, and
 * named by the manifestation. Nothing is fetched or parsed in this tier.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { importPlatformText } from '@/lib/base-knowledge/platform/texts'
import { importTextBodySchema } from '@/lib/base-knowledge/platform/text-wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () =>
      importPlatformText(
        session,
        params.changeRequestId,
        await parseJsonBody(request, importTextBodySchema),
        actingReaderIsAgent() ? 'agent' : 'person',
      ),
    ),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
