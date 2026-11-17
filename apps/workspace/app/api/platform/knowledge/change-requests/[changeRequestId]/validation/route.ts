import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { validatePlatformChangeRequest } from '@/lib/base-knowledge/platform/onboarding'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => validatePlatformChangeRequest(session, params.changeRequestId)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
