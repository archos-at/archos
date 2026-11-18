import 'server-only'
import { createHash } from 'node:crypto'
import { PayloadTooLargeError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { contentDisposition } from '@/lib/documents/content-disposition'
import { AGENT_FILE_MAX_BYTES } from '@/lib/documents/agent-file-types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { fetchDraftFromBackend } from './draft-backend'
import { draftFileName, draftFileType, type DraftFileType } from './draft-media'

export interface ConversationDraftBytes {
  path: string
  filename: string
  type: DraftFileType
  bytes: Uint8Array
  etag: string
}

const SANDBOXED_FILE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"

export async function readConversationDraftBytes(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<ConversationDraftBytes> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const response = await fetchDraftFromBackend(conversationId, path, { raw: true })
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > AGENT_FILE_MAX_BYTES) throw new PayloadTooLargeError(AGENT_FILE_MAX_BYTES)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > AGENT_FILE_MAX_BYTES) throw new PayloadTooLargeError(AGENT_FILE_MAX_BYTES)
  const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`
  return { path, filename: draftFileName(path) || 'download', type: draftFileType(path), bytes, etag }
}

export async function downloadConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<Response> {
  const draft = await readConversationDraftBytes(session, conversationId, path)
  return new Response(Buffer.from(draft.bytes), {
    status: 200,
    headers: {
      'Content-Type': draft.type.contentType,
      'Content-Length': String(draft.bytes.byteLength),
      'Content-Disposition': contentDisposition('attachment', draft.filename),
      'Content-Security-Policy': SANDBOXED_FILE_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache',
      ETag: draft.etag,
    },
  })
}
