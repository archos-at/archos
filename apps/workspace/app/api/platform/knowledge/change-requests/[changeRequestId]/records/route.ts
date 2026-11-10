/**
 * Propose records into a draft change request (ADR-0165, ADR-0170): up to 200
 * cited records of any type, validated by the kit first. Each record gets its
 * result; `dryRun` returns them and writes nothing; a proposal with problems is
 * refused whole (422, an RFC 9457 problem carrying every record's result). The
 * same proposal again changes nothing (`unchanged`).
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { proposePlatformRecords } from '@/lib/base-knowledge/platform/service'
import { proposeRecordsBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () =>
      proposePlatformRecords(
        session,
        params.changeRequestId,
        await parseJsonBody(request, proposeRecordsBodySchema),
        actingReaderIsAgent() ? 'agent' : 'person',
      ),
    ),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)
