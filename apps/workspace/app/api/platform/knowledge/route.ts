/**
 * The platform's base knowledge at a glance (ADR-0165): countries with their
 * released records, open requests, entitled offices and overdue editions, and
 * the review queue. Platform staff with `platform:settings:view`.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { platformKnowledgeOverview } from '@/lib/base-knowledge/platform/service'

export const GET = platformApiRoute(async ({ session }) => platformKnowledgeOverview(session), {
  permission: PLATFORM_PERMISSIONS.settingsView,
})
