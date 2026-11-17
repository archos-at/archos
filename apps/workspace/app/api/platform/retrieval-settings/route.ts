import { NextResponse } from 'next/server'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { parseJsonBody } from '@/lib/api/handler'
import { recordAuditEvent } from '@/lib/audit/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { retrievalSettingsPutSchema } from '@/lib/platform/platform-wire'
import { RETRIEVAL_SETTINGS } from '@/lib/retrieval-settings/catalog'
import {
  listPlatformRetrievalSettings,
  savePlatformRetrievalSettings,
} from '@/lib/retrieval-settings/service'

export const GET = platformApiRoute(
  async () => {
    const settings = await listPlatformRetrievalSettings()
    return NextResponse.json({ definitions: RETRIEVAL_SETTINGS, settings })
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PUT = platformApiRoute(
  async ({ request, session }) => {
    const input = await parseJsonBody(request, retrievalSettingsPutSchema)

    await savePlatformRetrievalSettings({
      settings: input.settings,
      note: input.note ?? null,
      actorUserId: session.userId,
      actorEmail: session.email ?? null,
    })

    const platformOrgId = await getPlatformOrganizationId()
    if (platformOrgId) {
      await recordAuditEvent({
        organizationId: platformOrgId,
        actor: { userId: session.userId, email: session.email },
        action: 'platform.retrieval_settings.updated',
        targetType: 'platform_retrieval_settings',
        targetId: 'platform',
        metadata: {
          settings: JSON.stringify(input.settings),
          changed: Object.keys(input.settings).length,
          note: input.note ?? null,
        },
        request,
      })
    } else {
      console.error(
        '[Platform Retrieval Settings] Settings were saved without an audit event: the platform organization did not resolve'
      )
    }

    return NextResponse.json({ settings: await listPlatformRetrievalSettings() })
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
