/**
 * Import territories into a draft change request (ADR-0165, design §3.2): a
 * bulk file of ISO 3166 rows becomes territory records, a code without a
 * subdivision a country, one with a subdivision a state of its country (or of
 * the parent the row names). The same kit and review as any other proposal.
 */

import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { proposePlatformRecords } from '@/lib/base-knowledge/platform/service'
import { territoriesFromIso } from '@/lib/base-knowledge/platform/territory-import'
import { territoryImportBodySchema } from '@/lib/base-knowledge/platform/wire'

type Params = { changeRequestId: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, territoryImportBodySchema)
    return proposePlatformRecords(
      session,
      params.changeRequestId,
      { records: territoriesFromIso(body.rows), dryRun: false },
      actingReaderIsAgent() ? 'agent' : 'person',
    )
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage },
)
