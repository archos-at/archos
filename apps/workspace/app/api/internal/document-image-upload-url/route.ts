import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { NotFoundError } from '@/lib/api/errors'
import { presignDocumentImageUpload } from '@/lib/documents/document-storage-keys'

const bodySchema = z.object({
  documentId: z.guid(),
  collection: z.string().min(1),
  imageIndex: z.number().int().min(0),
  organizationId: z.string().min(1).optional(),
})

export const POST = internalApiRoute(
  'document-image-upload-url',
  async ({ request }) => {
    const { documentId, collection, imageIndex, organizationId } = await parseJsonBody(request, bodySchema)
    return withOptionalTenant(
      organizationId,
      'document addressed by unguessable id and collection name, with no organization supplied',
      async () => {
        const slot = await presignDocumentImageUpload(documentId, collection, imageIndex, organizationId)
        if (!slot) throw new NotFoundError('Document not found, or image index past the per-document ceiling')
        return slot
      }
    )
  },
  { tenancy: { fromPayload: 'body.organizationId when the collection is an Archiv' } }
)
