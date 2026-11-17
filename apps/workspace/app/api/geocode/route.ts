import { apiRoute, parseQuery } from '@/lib/api/handler'
import { searchAddresses } from '@/lib/geocoding/service'
import { geocodeQuerySchema } from '@/lib/geocoding/types'

export const GET = apiRoute(
  async ({ request }) => searchAddresses(parseQuery(request, geocodeQuerySchema), request.signal),
  {
    authz: {
      sessionOnly: true,
      why: 'public map data looked up for the typed text; reads nothing stored and nothing scoped below the organization',
    },
  },
)
