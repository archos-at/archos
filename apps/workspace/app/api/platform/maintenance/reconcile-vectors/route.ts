import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { reconcileOrphanedVectors } from '@/lib/platform/vector-reconcile'

export const POST = platformApiRoute(
  async () => {
    const result = await reconcileOrphanedVectors()
    return NextResponse.json(result)
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
