import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { requireVerifiedContext } from '@/lib/api/internal-envelope'
import { withOptionalSystemReader, withTenant } from '@/lib/db/tenant-context'
import { NotFoundError } from '@/lib/api/errors'
import { restrictedCollectionBase } from '@/lib/authz/folder-access-rule'
import { drawableRestrictedCollections } from '@/lib/conversations/restricted-use'
import { decisionFromRequest, withTurnShelves } from '@/lib/conversation-context'
import type { ConversationDecision } from '@/lib/conversation-context/wire'
import {
  findDocumentImageStorageKey,
  findDocumentImageStorageKeyById,
  findDocumentStorageKey,
  findDocumentStorageKeyById,
} from '@/lib/documents/document-storage-keys'
import { activeCalibrationsOfPage } from '@/lib/drawing-calibrations/page-read'
import { type VerifiedRequestContext } from '@/lib/request-context'
import { hasHeader } from '@/lib/http/legacy-header-names'
import { isPersonalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { admitPersonalShelf } from '@/lib/conversations/personal-shelf-use'

type DocumentFileTarget = { readonly documentId: string } | { readonly filename: string }

const querySchema = z
  .object({
    collection: z.string().min(1),
    documentId: z.guid().optional(),
    filename: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
    imageIndex: z.coerce.number().int().min(0).optional(),
    calibrationsPage: z.coerce.number().int().min(1).optional(),
  })
  .transform(({ documentId, filename, ...rest }, ctx) => {
    const target: DocumentFileTarget | null = documentId ? { documentId } : filename ? { filename } : null
    if (target) return { ...rest, target }
    ctx.addIssue({ code: 'custom', message: 'name the document by documentId, or by filename' })
    return z.NEVER
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

function decidedFor(decision: ConversationDecision, context: VerifiedRequestContext, collection: string, restricted: boolean): boolean {
  if (decision.organizationId !== context.organizationId || decision.userId !== context.userId) return false
  if (decision.conversationId !== (context.conversationId ?? null)) return false
  if (!decision.may.shelves.some((entry) => entry.collection === collection)) return false
  return !restricted || decision.may.restrictedCollections.includes(collection)
}

async function requireReadable(
  collection: string,
  context: VerifiedRequestContext | null,
  decision: ConversationDecision | null = null
): Promise<void> {
  const personal = isPersonalShelfCollectionName(collection.toLowerCase())
  const restricted = isRestrictedCollection(collection) || personal
  if (!context) {
    if (restricted) throw new NotFoundError('Document not found')
    return
  }
  if (!context.collectionScope.includes(collection)) throw new NotFoundError('Document not found')
  if (decision && !decidedFor(decision, context, collection, restricted)) throw new NotFoundError('Document not found')
  if (!restricted) return
  if (!context.conversationId) throw new NotFoundError('Document not found')
  if (personal) {
    const request = {
      organizationId: context.organizationId,
      conversationId: context.conversationId,
      userId: context.userId,
      answerMessageId: decision?.answerMessageId ?? null,
    }
    if ((await admitPersonalShelf(request, [collection], decision)).length === 0) throw new NotFoundError('Document not found')
    return
  }
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

function imageOf({ collection, target }: DocumentFileQuery, imageIndex: number, organizationId: string | undefined) {
  return 'documentId' in target
    ? findDocumentImageStorageKeyById(collection, target.documentId, imageIndex, organizationId)
    : findDocumentImageStorageKey(collection, target.filename, imageIndex, organizationId)
}

function documentOf({ collection, target }: DocumentFileQuery, organizationId: string | undefined) {
  return 'documentId' in target
    ? findDocumentStorageKeyById(collection, target.documentId, organizationId)
    : findDocumentStorageKey(collection, target.filename, organizationId)
}

async function lookUp(query: DocumentFileQuery, organizationId: string | undefined) {
  if (query.imageIndex !== undefined) {
    const image = await imageOf(query, query.imageIndex, organizationId)
    if (!image) throw new NotFoundError('Document image not found')
    return { storageKey: image.storageKey, storageBucket: image.storageBucket, contentType: image.contentType }
  }
  const document = await documentOf(query, organizationId)
  if (!document) throw new NotFoundError('Document not found')
  return {
    documentId: document.id,
    storageKey: document.storageKey,
    storageBucket: document.storageBucket,
    contentType: document.contentType,
    versionId: document.versionId,
  }
}

type Found = Awaited<ReturnType<typeof lookUp>>

async function withCalibrations(found: Found, page: number | undefined, context: VerifiedRequestContext | null) {
  if (page === undefined) return found
  if (!context || !('documentId' in found) || !found.versionId) return { ...found, calibrations: [] }
  const calibrations = await activeCalibrationsOfPage(context.organizationId, {
    documentId: found.documentId,
    versionId: found.versionId,
    page,
  })
  return { ...found, calibrations }
}

export const GET = internalApiRoute(
  'document-file',
  async ({ request }) => {
    const query = parseQuery(request, querySchema)
    const presented = presentedContext(request)
    if (presented) {
      const context = withTurnShelves(request, presented)
      const decision = decisionFromRequest(request)
      if (query.organizationId && query.organizationId !== context.organizationId) {
        throw new NotFoundError('Document not found')
      }
      return withTenant({ organizationId: context.organizationId, userId: context.userId }, async () => {
        await requireReadable(query.collection, context, decision)
        return withCalibrations(await lookUp(query, context.organizationId), query.calibrationsPage, context)
      })
    }
    return withOptionalSystemReader(
      query.organizationId,
      'ingestion',
      'document addressed by collection name, with no envelope and no organization supplied',
      async () => {
        await requireReadable(query.collection, null)
        return withCalibrations(await lookUp(query, query.organizationId), query.calibrationsPage, null)
      }
    )
  },
  { tenancy: { fromPayload: 'the signed envelope, or ?organizationId when the collection is an Archiv' } }
)
