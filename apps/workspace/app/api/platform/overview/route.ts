import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOverview } from '@/lib/platform/service'

export const GET = platformApiRoute(
  async () => NextResponse.json(await getPlatformOverview()),
  { permission: PLATFORM_PERMISSIONS.organizationsView }
)
