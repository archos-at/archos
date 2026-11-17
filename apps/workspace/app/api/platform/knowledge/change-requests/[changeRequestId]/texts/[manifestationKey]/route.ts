import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { readPlatformText } from '@/lib/base-knowledge/platform/texts'

type Params = { changeRequestId: string; manifestationKey: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => readPlatformText(session, params.changeRequestId, params.manifestationKey)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
