import { internalApiRoute } from '@/lib/api/handler'
import { getPlatformRetrievalSettings } from '@/lib/retrieval-settings/service'

export const GET = internalApiRoute(
  'retrieval-settings',
  async () => {
    return { settings: await getPlatformRetrievalSettings() }
  },
  {
    tenancy: {
      crossTenant: 'retrieval depth is platform-wide configuration, identical for every tenant',
    },
  }
)
