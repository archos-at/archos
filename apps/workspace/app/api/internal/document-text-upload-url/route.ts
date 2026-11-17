import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { NotFoundError } from '@/lib/api/errors'
import { PAGE_TEXT_PARTS } from '@/lib/s3'
import { presignDocumentPageTextUpload } from '@/lib/documents/document-storage-keys'

const bodySchema = z.object({
  documentId: z.guid(),
  collection: z.string().min(1),
  part: z.enum(PAGE_TEXT_PARTS),
  organizationId: z.string().min(1).optional(),
})

export const POST = internalApiRoute(
  'document-text-upload-url',
  async ({ request }) => {
    const { documentId, collection, part, organizationId } = await parseJsonBody(request, bodySchema)
    return withOptionalTenant(
      organizationId,
      'document addressed by unguessable id and collection name, with no organization supplied',
      async () => {
        const slot = await presignDocumentPageTextUpload(documentId, collection, part, organizationId)
        if (!slot) throw new NotFoundError('Document not found')
        return slot
      }
    )
  },
  { tenancy: { fromPayload: 'body.organizationId, the organization of the ingest job' } }
)
