/**
 * Set the key a public source is fetched with (ADR-0174): write-only, the
 * person's own yes, audited. The answer says only that a key is set and its
 * last four characters; only the fetch reads it.
 */

import { BadRequestError } from '@/lib/api/errors'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { setPlatformSourceCredential } from '@/lib/base-knowledge/platform/source-service'
import { sourceCredentialBodySchema, sourceParamsSchema } from '@/lib/base-knowledge/platform/source-wire'

type Params = { sourceKey: string }

export const PUT = platformApiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      const parsed = sourceParamsSchema.safeParse(params)
      if (!parsed.success) throw new BadRequestError('sourceKey is a source id such as at-ris')
      const { sourceKey } = parsed.data
      const body = await parseJsonBody(request, sourceCredentialBodySchema)
      return setPlatformSourceCredential(session, sourceKey, body.secret)
    }),
  { permission: PLATFORM_PERMISSIONS.settingsManage },
)
