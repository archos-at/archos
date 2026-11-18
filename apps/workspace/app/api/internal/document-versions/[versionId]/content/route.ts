import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { readVersionForService } from '@/lib/documents/version-content'

type Params = { versionId: string }

const querySchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1).max(128).optional(),
  answerMessageId: z.guid().optional(),
})

export const GET = internalApiRoute<Params>(
  'document-version-content',
  async ({ request, params }) => {
    const { organizationId, conversationId, userId, answerMessageId } = parseQuery(request, querySchema)
    return withTenant({ organizationId }, async () => {
      const version = await readVersionForService(params.versionId, organizationId, conversationId, {
        askerUserId: userId ?? null,
        answerMessageId: answerMessageId ?? null,
      })
      return version
    })
  },
  {
    tenancy: {
      fromPayload:
        '?organizationId — required; a version id carries no scope of its own. ?conversationId ' +
        'narrows it further: the version must be that conversation’s subject resource.',
    },
  },
)
