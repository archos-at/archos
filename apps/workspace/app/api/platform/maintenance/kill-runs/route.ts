import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { killAllActiveRuns } from '@/lib/runs/kill-all'

export const POST = platformApiRoute(
  async ({ session }) => {
    console.warn('[Platform Maintenance] kill switch pressed by user', session.userId)
    const result = await killAllActiveRuns()
    console.warn('[Platform Maintenance] kill switch result', JSON.stringify(result))
    return NextResponse.json(result)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
