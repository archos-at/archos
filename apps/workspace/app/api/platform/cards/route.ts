import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getCardCatalog } from '@/lib/platform/card-catalog'

export const GET = platformApiRoute(
  async () => {
    return NextResponse.json(await getCardCatalog())
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)
