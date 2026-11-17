import { parseJsonBody } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { createPlatformChangeRequest, listPlatformChangeRequests } from '@/lib/base-knowledge/platform/service'
import { createChangeRequestBodySchema, listChangeRequestsQuerySchema } from '@/lib/base-knowledge/platform/wire'

export const GET = platformApiRoute(
  async ({ session, request }) => {
    const query = listChangeRequestsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!query.success) {
      throw new BadRequestError('status is one of draft, submitted, approved, rejected, published, rolled_back; countryId a country code such as AT; origin operator or monitor; secondReview due, confirmed or disputed; limit 1 to 200')
    }
    return listPlatformChangeRequests(session, query.data)
  },
  { permission: PLATFORM_PERMISSIONS.settingsView },
)

export const POST = platformApiRoute(
  async ({ session, request }) => createPlatformChangeRequest(session, await parseJsonBody(request, createChangeRequestBodySchema)),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite, status: 201 },
)
