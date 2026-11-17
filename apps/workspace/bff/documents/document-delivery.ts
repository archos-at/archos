import 'server-only'
import { contentDisposition } from './content-disposition'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, signingS3Client, buildThumbnailStorageKey } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { isFolderVisibleToMember } from '@/lib/authz/folder-access'
import { ForbiddenError } from '@/lib/api/errors'
import { ApiError, NotFoundError } from '@/lib/api/errors'
import { buildDocumentImageUrl, DOCUMENT_IMAGE_CACHE_CONTROL, verifyDocumentImageUrl } from '@/lib/images/signed-image-url'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { findDocumentInOrg } from './repository'
import { decodeTextBytes } from '@/lib/text/decode-text'
import { getAccessibleDocument } from './access'
import { hasPassedScreening, SCREENED_ONLY } from './document-reader'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { INLINE_PREVIEW_CONTENT_TYPES, TEXT_PREVIEW_CONTENT_TYPES as SHARED_TEXT_PREVIEW_CONTENT_TYPES, isRenditionSource } from './preview-types'
import { RenditionFailedError, RenditionUnavailableError, ensureRendition, isRenditionEnabledFor } from './rendition'

const PREVIEW_CONTENT_TYPES: readonly string[] = INLINE_PREVIEW_CONTENT_TYPES

const TEXT_PREVIEW_CONTENT_TYPES: readonly string[] = SHARED_TEXT_PREVIEW_CONTENT_TYPES

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024

const OPTIMIZABLE_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]

const presignTtlSeconds = (): number => Number(process.env.SEAWEED_PRESIGNED_URL_TTL_SECONDS || 600)

const RENDITION_READER_WAIT_MS = 85_000

export async function getDocumentDownload(
  session: AuthorizedSession,
  documentId: string,
  options: { format?: 'pdf' } = {}
): Promise<{
  downloadUrl: string
  filename: string
  contentType: string | null
  fileSize: number | null
}> {
  const doc = await getAccessibleDocument(session, documentId)
  if (!doc.storageKey) throw new NotFoundError('File not available')
  const asRendition = options.format === 'pdf' && servedAsRendition(doc)
  if (options.format === 'pdf' && !asRendition && doc.contentType !== 'application/pdf') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'This file has no PDF form', { contentType: doc.contentType })
  }
  const key = asRendition ? await officeRenditionKey(doc, doc.contentType || 'application/octet-stream') : doc.storageKey
  const filename = asRendition ? renditionFilename(doc.filename) : doc.filename

  const downloadUrl = await getSignedUrl(
    signingS3Client,
    new GetObjectCommand({
      Bucket: resolveDocumentBucket(doc.storageBucket),
      Key: key,
      ResponseContentDisposition: contentDisposition('attachment', filename),
      ...(asRendition ? { ResponseContentType: 'application/pdf' } : {}),
    }),
    { expiresIn: presignTtlSeconds() }
  )
  await recordDocumentAccess(session, doc, 'download')

  return {
    downloadUrl,
    filename,
    contentType: asRendition ? 'application/pdf' : doc.contentType,
    fileSize: asRendition ? null : doc.fileSize,
  }
}

async function officeRenditionKey(
  doc: Pick<Document, 'storageKey' | 'storageBucket' | 'filename' | 'contentType'>,
  contentType: string
): Promise<string> {
  const unsupported = () =>
    new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Preview not available for this file type', { contentType })
  if (!isRenditionEnabledFor(doc) || !doc.storageKey) throw unsupported()
  try {
    return await ensureRendition(
      {
        bucket: resolveDocumentBucket(doc.storageBucket),
        storageKey: doc.storageKey,
        filename: doc.filename,
        contentType: doc.contentType,
      },
      { readerWaitMs: RENDITION_READER_WAIT_MS }
    )
  } catch (error) {
    if (error instanceof RenditionUnavailableError) throw unsupported()
    if (error instanceof RenditionFailedError) {
      console.warn('[documents] office rendition failed:', error.message)
      throw new ApiError(502, 'RENDITION_FAILED', 'The PDF preview of this file could not be created')
    }
    throw error
  }
}

function renditionFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return `${dot > 0 ? filename.slice(0, dot) : filename}.pdf`
}

export function servedAsRendition(doc: Pick<Document, 'contentType' | 'filename'>): boolean {
  const contentType = doc.contentType || 'application/octet-stream'
  if (PREVIEW_CONTENT_TYPES.includes(contentType)) return false
  return isRenditionSource({ contentType: doc.contentType, filename: doc.filename })
}

export interface DocumentPreview {
  url: string
  contentType: string
  filename: string
  imageUrl: string | null
  rendition: boolean
  sourceContentType: string | null
}

export async function getDocumentPreview(
  session: AuthorizedSession,
  documentId: string
): Promise<DocumentPreview> {
  const doc = await getAccessibleDocument(session, documentId)
  if (!doc.storageKey) throw new NotFoundError('File not available')

  const contentType = doc.contentType || 'application/octet-stream'
  if (servedAsRendition(doc)) {
    const renditionKey = await officeRenditionKey(doc, contentType)
    const url = await getSignedUrl(
      signingS3Client,
      new GetObjectCommand({
        Bucket: resolveDocumentBucket(doc.storageBucket),
        Key: renditionKey,
        ResponseContentDisposition: contentDisposition('inline', renditionFilename(doc.filename)),
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: 3600 }
    )
    await recordDocumentAccess(session, doc, 'preview')
    return {
      url,
      contentType: 'application/pdf',
      filename: doc.filename,
      imageUrl: null,
      rendition: true,
      sourceContentType: doc.contentType ?? null,
    }
  }

  if (!PREVIEW_CONTENT_TYPES.includes(contentType)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Preview not available for this file type', {
      contentType,
    })
  }

  const url = await getSignedUrl(
    signingS3Client,
    new GetObjectCommand({
      Bucket: resolveDocumentBucket(doc.storageBucket),
      Key: doc.storageKey,
      ResponseContentDisposition: contentDisposition('inline', doc.filename),
      ResponseContentType: contentType,
    }),
    { expiresIn: 3600 }
  )
  await recordDocumentAccess(session, doc, 'preview')

  const imageUrl =
    OPTIMIZABLE_IMAGE_CONTENT_TYPES.includes(contentType) && hasPassedScreening(doc)
      ? buildDocumentImageUrl(session.organizationId, session.userId, documentId, 'original')
      : null

  return { url, contentType, filename: doc.filename, imageUrl, rendition: false, sourceContentType: null }
}

export async function streamDocumentFile(
  session: AuthorizedSession,
  documentId: string
): Promise<Response> {
  const doc = await getAccessibleDocument(session, documentId)
  if (!doc.storageKey) throw new NotFoundError('File not available')

  const contentType = doc.contentType || 'application/octet-stream'
  let key = doc.storageKey
  let filename = doc.filename
  if (servedAsRendition(doc)) {
    key = await officeRenditionKey(doc, contentType)
    filename = renditionFilename(doc.filename)
  } else if (contentType !== 'application/pdf') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PDF documents stream from this route', {
      contentType,
    })
  }

  let body
  try {
    const object = await s3Client.send(
      new GetObjectCommand({
        Bucket: resolveDocumentBucket(doc.storageBucket),
        Key: key,
      })
    )
    body = object.Body
  } catch {
    throw new NotFoundError('File not available')
  }
  if (!body) throw new NotFoundError('File not available')
  await recordDocumentAccess(session, doc, 'pdf')

  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')
  return new Response(body.transformToWebStream(), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${asciiName}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
}

export async function getDocumentTextPreview(
  session: AuthorizedSession,
  documentId: string
): Promise<{ text: string; truncated: boolean; contentType: string; filename: string }> {
  const doc = await getAccessibleDocument(session, documentId)
  if (!doc.storageKey) throw new NotFoundError('File not available')

  const contentType = doc.contentType || 'application/octet-stream'
  if (!TEXT_PREVIEW_CONTENT_TYPES.includes(contentType)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Not a text document: only plain text, Markdown and CSV files are served as text. Read a PDF or an office ' +
        'document by its pages with passage-read, or a version’s text with document-version-content-get.',
      { contentType }
    )
  }

  let bytes: Uint8Array
  try {
    const object = await s3Client.send(
      new GetObjectCommand({
        Bucket: resolveDocumentBucket(doc.storageBucket),
        Key: doc.storageKey,
        Range: `bytes=0-${TEXT_PREVIEW_MAX_BYTES}`,
      })
    )
    if (!object.Body) throw new NotFoundError('File not available')
    bytes = await object.Body.transformToByteArray()
  } catch {
    throw new NotFoundError('File not available')
  }
  await recordDocumentAccess(session, doc, 'text')

  const truncated = bytes.byteLength > TEXT_PREVIEW_MAX_BYTES
  let { text } = decodeTextBytes(bytes.subarray(0, TEXT_PREVIEW_MAX_BYTES), { truncated })
  if (truncated) {
    const lastBreak = text.lastIndexOf('\n')
    if (lastBreak > 0) text = text.slice(0, lastBreak)
  }

  return { text, truncated, contentType, filename: doc.filename }
}

export async function getDocumentThumbnail(
  session: AuthorizedSession,
  documentId: string
): Promise<{ url: string | null }> {
  const doc = await getAccessibleDocument(session, documentId)
  if (!doc.storageKey) return { url: null }
  if (!hasPassedScreening(doc)) return { url: null }

  const thumbnailKey = buildThumbnailStorageKey(doc.storageKey)
  if (!thumbnailKey) return { url: null }

  try {
    const head = await s3Client.send(
      new HeadObjectCommand({
        Bucket: resolveDocumentBucket(doc.storageBucket),
        Key: thumbnailKey,
      })
    )
    if ((head?.ContentLength ?? 0) <= 0) return { url: null }
  } catch {
    return { url: null }
  }

  const signedUrl = buildDocumentImageUrl(session.organizationId, session.userId, documentId, 'thumb')
  if (signedUrl) return { url: signedUrl }

  try {
    const url = await getSignedUrl(
      signingS3Client,
      new GetObjectCommand({
        Bucket: resolveDocumentBucket(doc.storageBucket),
        Key: thumbnailKey,
        ResponseContentType: 'image/jpeg',
      }),
      { expiresIn: 3600 }
    )
    return { url }
  } catch {
    return { url: null }
  }
}

export async function streamDocumentImage(
  documentId: string,
  params: URLSearchParams
): Promise<Response> {
  const verified = verifyDocumentImageUrl(documentId, params)
  if (!verified.ok) {
    if (verified.reason === 'disabled') {
      throw new ApiError(503, 'IMAGE_URLS_DISABLED', 'Signed image URLs are not configured')
    }
    throw new ForbiddenError('Invalid or expired image URL')
  }

  const { organizationId, userId, variant } = verified.claims
  const doc = await findDocumentInOrg(documentId, organizationId, SCREENED_ONLY)
  if (!doc?.storageKey) throw new NotFoundError()
  if (
    doc.scope === 'project' &&
    doc.projectId &&
    !(await isFolderVisibleToMember(organizationId, doc.projectId, doc.folderId, userId))
  ) {
    throw new NotFoundError()
  }

  const contentType = variant === 'thumb' ? 'image/jpeg' : doc.contentType || ''
  if (!contentType.startsWith('image/')) throw new NotFoundError()

  const key = variant === 'thumb' ? buildThumbnailStorageKey(doc.storageKey) : doc.storageKey
  if (!key) throw new NotFoundError('Image not available')

  let body
  try {
    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: resolveDocumentBucket(doc.storageBucket), Key: key })
    )
    if ((object?.ContentLength ?? 0) <= 0) throw new NotFoundError('Image not available')
    body = object.Body
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new NotFoundError('Image not available')
  }
  if (!body) throw new NotFoundError('Image not available')

  return new Response(body.transformToWebStream(), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': DOCUMENT_IMAGE_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
