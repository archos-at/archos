import { BadRequestError } from '@/lib/api/errors'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { testPlatformSource } from '@/lib/base-knowledge/platform/source-service'
import { sourceParamsSchema, sourceTestBodySchema } from '@/lib/base-knowledge/platform/source-wire'

type Params = { sourceKey: string }

export const POST = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const parsed = sourceParamsSchema.safeParse(params)
      if (!parsed.success) throw new BadRequestError('sourceKey is a source id such as at-ris')
      const { sourceKey } = parsed.data
      return testPlatformSource(session, sourceKey, await parseJsonBody(request, sourceTestBodySchema))
    }),
  { permission: PLATFORM_PERMISSIONS.knowledgeWrite },
)
