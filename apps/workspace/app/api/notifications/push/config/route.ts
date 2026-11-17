import { apiRoute } from '@/lib/api/handler'
import { getPushConfig } from '@/lib/push/service'

export const GET = apiRoute(async () => getPushConfig(), {
  authz: { sessionOnly: true, why: 'a deployment-wide setting and a public key, nothing scoped below the organization' },
})
