import { createHmac, timingSafeEqual } from 'node:crypto'
import { isDevEnvironment } from '@/lib/internal-auth'

export type DocumentImageVariant = 'original' | 'thumb'

const SIGNATURE_DOMAIN = 'grid:document-image:v2'
const DEV_DEFAULT_TOKEN = 'grid-internal-dev-token'

export const IMAGE_URL_WINDOW_SECONDS = 300

export const DOCUMENT_IMAGE_CACHE_CONTROL = `private, max-age=${IMAGE_URL_WINDOW_SECONDS}`

function signingSecret(): string | null {
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) {
    warnDisabledOnce('INTERNAL_API_TOKEN is not set')
    return null
  }
  if (secret === DEV_DEFAULT_TOKEN && !isDevEnvironment()) {
    warnDisabledOnce(
      `INTERNAL_API_TOKEN is the well-known dev default and APP_ENV is ` +
        `"${process.env.APP_ENV ?? process.env.NODE_ENV ?? 'production'}". Anyone who has read ` +
        `the compose file could otherwise mint an image URL for any document, so signing is off. ` +
        `Set a real INTERNAL_API_TOKEN on this environment (note that APP_ENV is "production" ` +
        `on every deployed stack, dev ones included).`,
    )
    return null
  }
  return secret
}

let disabledWarningLogged = false
function warnDisabledOnce(reason: string): void {
  if (disabledWarningLogged) return
  disabledWarningLogged = true
  console.error(
    `[signed-image-url] Document image optimization is DISABLED: ${reason}. ` +
      `Images fall back to presigned object-store URLs and next/image will not resize them.`,
  )
}

export function resetSigningWarning(): void {
  disabledWarningLogged = false
}

export interface DocumentImageClaims {
  organizationId: string
  userId: string
  documentId: string
  variant: DocumentImageVariant
  exp: number
}

function signature(claims: DocumentImageClaims, secret: string): string {
  const message = [
    SIGNATURE_DOMAIN,
    claims.organizationId,
    claims.userId,
    claims.documentId,
    claims.variant,
    String(claims.exp),
  ].join(':')
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

export function imageUrlExpiry(nowMs: number = Date.now()): number {
  const nowSeconds = Math.floor(nowMs / 1000)
  return (Math.floor(nowSeconds / IMAGE_URL_WINDOW_SECONDS) + 2) * IMAGE_URL_WINDOW_SECONDS
}

export interface DocumentImageUrlOptions {
  nowMs?: number
}

export function buildDocumentImageUrl(
  organizationId: string,
  userId: string,
  documentId: string,
  variant: DocumentImageVariant,
  { nowMs = Date.now() }: DocumentImageUrlOptions = {},
): string | null {
  const secret = signingSecret()
  if (!secret) return null

  const claims: DocumentImageClaims = {
    organizationId,
    userId,
    documentId,
    variant,
    exp: imageUrlExpiry(nowMs),
  }
  const query = new URLSearchParams({
    org: organizationId,
    u: userId,
    v: variant,
    exp: String(claims.exp),
    sig: signature(claims, secret),
  })
  return `/api/documents/${encodeURIComponent(documentId)}/image?${query.toString()}`
}

export type ImageUrlRejection = 'disabled' | 'malformed' | 'expired' | 'bad-signature'

export type ImageUrlVerification =
  | { ok: true; claims: DocumentImageClaims }
  | { ok: false; reason: ImageUrlRejection }

export function verifyDocumentImageUrl(
  documentId: string,
  params: URLSearchParams,
  nowMs: number = Date.now(),
): ImageUrlVerification {
  const secret = signingSecret()
  if (!secret) return { ok: false, reason: 'disabled' }

  const organizationId = params.get('org')
  const userId = params.get('u')
  const variant = params.get('v')
  const exp = Number(params.get('exp'))
  const provided = params.get('sig')

  if (!organizationId || !userId || !provided) return { ok: false, reason: 'malformed' }
  if (variant !== 'original' && variant !== 'thumb') return { ok: false, reason: 'malformed' }
  if (!Number.isSafeInteger(exp) || exp <= 0) return { ok: false, reason: 'malformed' }

  if (exp * 1000 <= nowMs) return { ok: false, reason: 'expired' }

  const claims: DocumentImageClaims = { organizationId, userId, documentId, variant, exp }
  const expected = signature(claims, secret)

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' }
  }
  return { ok: true, claims }
}
