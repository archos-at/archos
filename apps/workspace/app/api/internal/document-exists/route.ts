import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { documentStillExists } from '@/lib/documents/document-details'
import { isTextHeld } from '@/lib/base-knowledge/text-guard'
import { isOfficeShelfCollectionName, officeShelfOrganizationId } from '@/lib/office-shelf/collection-prefix'

const querySchema = z.object({
  documentId: z.guid(),
  collection: z.string().min(1),
  organizationId: z.string().min(1).optional(),
})

export const GET = internalApiRoute(
  'document-exists',
  async ({ request }) => {
    const { documentId, collection, organizationId } = parseQuery(request, querySchema)
    if (!(await documentStillExists(documentId, collection, organizationId))) return { exists: false }
    if (!isOfficeShelfCollectionName(collection)) return { exists: true }
    const office = organizationId ?? officeShelfOrganizationId(collection)
    return { exists: !(office && (await isTextHeld(office, documentId))) }
  },
  { tenancy: { fromPayload: '?organizationId, the org the ingest was dispatched for' } }
)
