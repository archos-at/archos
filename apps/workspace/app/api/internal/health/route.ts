import { internalApiRoute } from '@/lib/api/handler'

export const GET = internalApiRoute(
  'Internal Health',
  async () => {
    return { ok: true }
  },
  { tenancy: { crossTenant: 'token handshake only — reads nothing from the database' } }
)
