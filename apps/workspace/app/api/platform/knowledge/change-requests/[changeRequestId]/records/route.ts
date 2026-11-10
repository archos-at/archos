/**
 * Propose records into a draft change request (ADR-0165): up to 200 cited
 * records of any type, validated by the kit first. `dryRun` returns the
 * problems and writes nothing; a proposal with problems is refused (422).
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { proposePlatformRecords } from '@/lib/base-knowledge/platform/service'
import { proposeRecordsBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    proposePlatformRecords(
      session,
      params.changeRequestId,
      await parseJsonBody(request, proposeRecordsBodySchema),
      actingReaderIsAgent() ? 'agent' : 'person',
    ),
  { permission: PLATFORM_PERMISSIONS.settingsManage },
)
