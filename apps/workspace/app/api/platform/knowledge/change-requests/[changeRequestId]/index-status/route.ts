/**
 * Whether the texts a change request published are indexed (ADR-0165): each
 * run's state, `indexed` only once the base corpus reports the file's chunks.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { platformIndexStatus } from '@/lib/base-knowledge/platform/service'

type Params = { changeRequestId: string }

export const GET = platformApiRoute<Params>(async ({ session, params }) => platformIndexStatus(session, params.changeRequestId), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
