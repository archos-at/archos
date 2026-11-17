import { internalApiRoute } from '@/lib/api/handler'
import { getPlatformReasoningEfforts } from '@/lib/reasoning-settings/service'

export const GET = internalApiRoute(
  'reasoning-efforts',
  async () => {
    return { efforts: await getPlatformReasoningEfforts() }
  },
  {
    tenancy: {
      crossTenant: 'reasoning effort is platform-wide configuration, identical for every tenant',
    },
  }
)
