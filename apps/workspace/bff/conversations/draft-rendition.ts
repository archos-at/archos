import 'server-only'
import { ServiceUnavailableError, UnprocessableError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { contentDisposition } from '@/lib/documents/content-disposition'
import { convertOfficeToPdf, RenditionUnavailableError } from '@/lib/documents/rendition'
import { readConversationDraftBytes, type ConversationDraftBytes } from './draft-file'

const DRAFT_RENDITION_TIMEOUT_MS = 45_000

const MAX_CACHED_RENDITION_BYTES = 8_000_000

const MAX_CACHED_RENDITIONS = 32

const renditions = new Map<string, Uint8Array>()

function remember(key: string, pdf: Uint8Array): void {
  if (pdf.byteLength > MAX_CACHED_RENDITION_BYTES) return
  renditions.delete(key)
  renditions.set(key, pdf)
  while (renditions.size > MAX_CACHED_RENDITIONS) {
    const oldest = renditions.keys().next().value
    if (oldest === undefined) break
    renditions.delete(oldest)
  }
}

function recall(key: string): Uint8Array | null {
  const hit = renditions.get(key)
  if (!hit) return null
  renditions.delete(key)
  renditions.set(key, hit)
  return hit
}

export function forgetDraftRenditions(): void {
  renditions.clear()
}

async function officePdf(session: AuthorizedSession, conversationId: string, draft: ConversationDraftBytes) {
  const key = `${session.organizationId}\u0000${conversationId}\u0000${draft.etag}`
  const cached = recall(key)
  if (cached) return cached
  try {
    const pdf = await convertOfficeToPdf(new Blob([Buffer.from(draft.bytes)]), draft.filename, DRAFT_RENDITION_TIMEOUT_MS)
    remember(key, pdf)
    return pdf
  } catch (error) {
    if (error instanceof RenditionUnavailableError) throw new ServiceUnavailableError('Office preview is not configured')
    throw new UpstreamError('The file could not be shown as a PDF', { reason: 'rendition-failed' })
  }
}

function pdfName(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return `${dot > 0 ? filename.slice(0, dot) : filename}.pdf`
}

export async function renderConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const draft = await readConversationDraftBytes(session, conversationId, path)
  if (draft.type.preview !== 'office' && draft.type.preview !== 'pdf') {
    throw new UnprocessableError('Only Word, Excel, PowerPoint and PDF drafts have a PDF rendition', {
      reason: 'no-rendition',
    })
  }
  const headers = {
    'Cache-Control': 'private, no-cache',
    ETag: draft.etag,
    'X-Content-Type-Options': 'nosniff',
  }
  if (ifNoneMatch === draft.etag) return new Response(null, { status: 304, headers })

  const pdf = draft.type.preview === 'pdf' ? draft.bytes : await officePdf(session, conversationId, draft)
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Content-Disposition': contentDisposition('inline', pdfName(draft.filename)),
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
}
