import { z } from 'zod'

export const conversationDraftPreviewSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  encoding: z.enum(['utf-8', 'base64']).optional(),
  version: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().optional(),
})

export type ConversationDraftPreview = z.infer<typeof conversationDraftPreviewSchema>

export type DraftPreviewFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: DraftPreviewFetch = (path, init) => fetch(path, init)

export class DocumentDraftPreviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DocumentDraftPreviewError'
  }
}

function draftQuery(conversationId: string, route: '' | '/download' | '/rendition', path: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/draft${route}?path=${encodeURIComponent(path)}`
}

export interface DraftFileUrls {
  download: string
  rendition: string
}

export function draftFileUrls(conversationId: string, path: string, version: number): DraftFileUrls {
  const stamp = `&v=${version}`
  return {
    download: `${draftQuery(conversationId, '/download', path)}${stamp}`,
    rendition: `${draftQuery(conversationId, '/rendition', path)}${stamp}`,
  }
}

export async function fetchConversationDraft(
  conversationId: string,
  path: string,
  run: DraftPreviewFetch = defaultFetch,
): Promise<ConversationDraftPreview> {
  const url = draftQuery(conversationId, '', path)
  const response = await run(url, { method: 'GET' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string }
    throw new DocumentDraftPreviewError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
    )
  }
  return conversationDraftPreviewSchema.parse(body)
}
