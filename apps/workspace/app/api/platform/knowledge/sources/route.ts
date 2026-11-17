/**
 * Every configured public source (ADR-0174): published and proposed, with its
 * hosts and their state, its monitor's last check and freshness lag, and
 * whether a key is set (never the key).
 */

import { BadRequestError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { platformSourceStatus } from '@/lib/base-knowledge/platform/source-service'
import { sourceStatusQuerySchema } from '@/lib/base-knowledge/platform/source-wire'

export const GET = platformApiRoute(
  async ({ session, request }) => {
    const query = sourceStatusQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!query.success) throw new BadRequestError('sourceKey is a source id such as at-ris')
    return platformSourceStatus(session, query.data)
  },
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
