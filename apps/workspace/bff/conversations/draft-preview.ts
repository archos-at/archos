import 'server-only'
import { z } from 'zod'
import { UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { fetchDraftFromBackend } from './draft-backend'
import { draftFileType } from './draft-media'

const filingSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  contentHash: z.string().min(1),
  state: z.string().min(1),
})

const factsSchema = z.object({
  version: z.number().int().nonnegative(),
  filed: filingSchema.optional(),
  filed_at_version: z.number().int().nonnegative().optional(),
  previous_version: z.number().int().positive().optional(),
  derived_from: z.object({ document_id: z.string().min(1), name: z.string().min(1) }).optional(),
})

export interface DraftFiling {
  documentId: string
  versionId: string
  contentHash: string
  state: string
  filedAtVersion: number
}

export interface DraftFacts {
  version: number
  filing: DraftFiling | null
  previousVersion: number | null
  derivedFrom: { documentId: string; name: string } | null
}

export async function readDraftFacts(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<DraftFacts> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const response = await fetchDraftFromBackend(conversationId, path, { raw: false })
  const parsed = factsSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new UpstreamError('Draft preview answered unexpectedly')
  const { version, filed, filed_at_version: filedAt, previous_version: previous, derived_from: derived } = parsed.data
  return {
    version,
    filing: filed ? { ...filed, filedAtVersion: filedAt ?? 0 } : null,
    previousVersion: previous ?? null,
    derivedFrom: derived ? { documentId: derived.document_id, name: derived.name } : null,
  }
}

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
