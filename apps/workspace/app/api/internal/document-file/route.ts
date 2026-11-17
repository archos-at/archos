import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withOptionalTenant, withTenant } from '@/lib/db/tenant-context'
import { NotFoundError } from '@/lib/api/errors'
import { restrictedCollectionBase } from '@/lib/authz/folder-access-rule'
import { drawableRestrictedCollections } from '@/lib/conversations/restricted-use'
import { findDocumentImageStorageKey, findDocumentStorageKey } from '@/lib/documents/document-storage-keys'
import { type VerifiedRequestContext } from '@/lib/request-context'
import { hasHeader } from '@/lib/http/legacy-header-names'

const querySchema = z.object({
  collection: z.string().min(1),
  filename: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  imageIndex: z.coerce.number().int().min(0).optional(),
})

type DocumentFileQuery = z.infer<typeof querySchema>

function presentedContext(request: Request): VerifiedRequestContext | null {
  const presented =
    hasHeader(request.headers, 'X-Request-Context') || hasHeader(request.headers, 'X-Request-Context-Sig')
  return presented ? requireVerifiedContext(request) : null
}

function isRestrictedCollection(collection: string): boolean {
  return restrictedCollectionBase(collection.toLowerCase()) !== null
}

async function requireReadable(collection: string, context: VerifiedRequestContext | null): Promise<void> {
  const restricted = isRestrictedCollection(collection)
  if (!context) {
    if (restricted) throw new NotFoundError('Document not found')
    return
  }
  if (!context.collectionScope.includes(collection)) throw new NotFoundError('Document not found')
  if (!restricted) return
  if (!context.conversationId) throw new NotFoundError('Document not found')
  const drawable = await drawableRestrictedCollections(
    {
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      userId: context.userId,
      projectId: context.projectId,
    },
    [collection]
  )
  if (!drawable.includes(collection)) throw new NotFoundError('Document not found')
}

async function lookUp({ collection, filename, imageIndex }: DocumentFileQuery, organizationId: string | undefined) {
  if (imageIndex !== undefined) {
    const image = await findDocumentImageStorageKey(collection, filename, imageIndex, organizationId)
    if (!image) throw new NotFoundError('Document image not found')
    return { storageKey: image.storageKey, storageBucket: image.storageBucket, contentType: image.contentType }
  }
  const document = await findDocumentStorageKey(collection, filename, organizationId)
  if (!document) throw new NotFoundError('Document not found')
  return {
    documentId: document.id,
    storageKey: document.storageKey,
    storageBucket: document.storageBucket,
    contentType: document.contentType,
    versionId: document.versionId,
  }
}

export const GET = internalApiRoute(
  'document-file',
  async ({ request }) => {
    const query = parseQuery(request, querySchema)
    const context = presentedContext(request)
    if (context) {
      if (query.organizationId && query.organizationId !== context.organizationId) {
        throw new NotFoundError('Document not found')
      }
      return withTenant({ organizationId: context.organizationId }, async () => {
        await requireReadable(query.collection, context)
        return lookUp(query, context.organizationId)
      })
    }
    return withOptionalTenant(
      query.organizationId,
      'document addressed by collection name, with no envelope and no organization supplied',
      async () => {
        await requireReadable(query.collection, null)
        return lookUp(query, query.organizationId)
      }
    )
  },
  { tenancy: { fromPayload: 'the signed envelope, or ?organizationId when the collection is an Archiv' } }
)
