import 'server-only'
import { z } from 'zod'
import { UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { fetchDraftFromBackend } from './draft-backend'
import { draftFileType } from './draft-media'

const textDraftSchema = z.object({
  path: z.string(),
  content: z.string(),
  version: z.number().int().nonnegative(),
})

const binaryDraftSchema = z.object({
  path: z.string(),
  encoding: z.literal('base64'),
  bytes: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
})

export type ConversationDraftPreview =
  | { path: string; encoding: 'utf-8'; content: string; version: number; bytes: number; mediaType: string }
  | { path: string; encoding: 'base64'; version: number; bytes: number; mediaType: string }

export async function readConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<ConversationDraftPreview> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const response = await fetchDraftFromBackend(conversationId, path, { raw: false })
  const body: unknown = await response.json().catch(() => null)

  const binary = binaryDraftSchema.safeParse(body)
  if (binary.success) {
    const { path: shownPath, bytes, version } = binary.data
    return { path: shownPath, encoding: 'base64', bytes, version, mediaType: draftFileType(shownPath).contentType }
  }
  const text = textDraftSchema.safeParse(body)
  if (!text.success) throw new UpstreamError('Draft preview answered unexpectedly')
  return {
    path: text.data.path,
    encoding: 'utf-8',
    content: text.data.content,
    version: text.data.version,
    bytes: Buffer.byteLength(text.data.content, 'utf8'),
    mediaType: draftFileType(text.data.path).contentType,
  }
}
