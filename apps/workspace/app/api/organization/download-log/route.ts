import { apiRoute, parseQuery } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { downloadLogQuerySchema } from '@/lib/organizations/organization-wire'
import { listDownloadLog } from '@/lib/download-log/service'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export const GET = apiRoute(
  async ({ session, request }) => {
    const { to, ...query } = parseQuery(request, downloadLogQuerySchema)
    return listDownloadLog(
      session,
      { ...query, ...(to ? { to: new Date(to.getTime() + ONE_DAY_MS) } : {}) },
      request
    )
  },
  { authz: { permission: ORG_PERMISSIONS.downloadLogView } }
)
