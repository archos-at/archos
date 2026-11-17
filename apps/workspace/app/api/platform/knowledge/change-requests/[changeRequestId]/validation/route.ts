/**
 * Run the validation kit on everything a change request holds (ADR-0170): the
 * newest proposal of each record, with KC-1, KC-3 and KC-6. Writes nothing;
 * submit runs the same and refuses a request that is not valid.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { validatePlatformChangeRequest } from '@/lib/base-knowledge/platform/onboarding'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => validatePlatformChangeRequest(session, params.changeRequestId)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
