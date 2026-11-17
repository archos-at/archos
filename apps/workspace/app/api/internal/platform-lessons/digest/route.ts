import { internalApiRoute } from '@/lib/api/handler'
import { buildPlatformLessonsInjection } from '@/lib/platform-lessons/service'

export const GET = internalApiRoute(
  'platform-lessons-digest',
  async () => {
    return await buildPlatformLessonsInjection()
  },
  {
    tenancy: {
      crossTenant:
        'platform lessons are anonymized fleet-wide knowledge, identical for every tenant',
    },
  }
)
