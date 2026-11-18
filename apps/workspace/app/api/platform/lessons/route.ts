import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getLessonOverview, runLessonSweep } from '@/lib/platform-lessons/service'

export const GET = platformApiRoute(
  async ({ session }) => {
    return getLessonOverview(session)
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const POST = platformApiRoute(
  async ({ session }) => {
    return { result: await runLessonSweep(session) }
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
