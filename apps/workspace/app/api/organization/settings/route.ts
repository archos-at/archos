import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { getOrgSettings, saveOrgSettings } from '@/lib/organizations/service'
import { orgSettingsPutSchema } from '@/lib/organizations/organization-wire'
import { ensureOrganizationRow, stateHomeCountry } from '@/lib/organizations/home-country-row'

export const GET = apiRoute(
  async ({ session }) => ({ settings: await getOrgSettings(session.organizationId) }),
  {
    authz: {
      sessionOnly: true,
      why: "every member may read their own organization's settings; the read is keyed by session.organizationId and writes require org:settings:manage below",
    },
  }
)

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { homeCountry, ...patch } = await parseJsonBody(request, orgSettingsPutSchema)
    await ensureOrganizationRow(session.organizationId)
    if (homeCountry) await stateHomeCountry(session.organizationId, homeCountry)
    return { settings: await saveOrgSettings(session, patch, request) }
  },
  { authz: { permission: ORG_PERMISSIONS.settingsManage } }
)
