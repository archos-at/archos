import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withOptionalSystemReader } from '@/lib/db/tenant-context'
import { listDocumentIdsInCollection } from '@/lib/documents/repository'

const querySchema = z.object({
  collection: z.string().min(1),
  organizationId: z.string().min(1).optional(),
})

export const GET = internalApiRoute(
  'document-ids',
  async ({ request }) => {
    const { collection, organizationId } = parseQuery(request, querySchema)
    return withOptionalSystemReader(
      organizationId,
      'ingestion',
      'documents addressed by unguessable collection name, with no organization supplied',
      async () => ({ documents: await listDocumentIdsInCollection(collection, organizationId) })
    )
  },
  { tenancy: { fromPayload: '?organizationId, the org whose collection the backend re-keys' } }
)
