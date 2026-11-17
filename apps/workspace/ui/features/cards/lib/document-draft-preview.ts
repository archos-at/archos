import { z } from 'zod'

export const conversationDraftPreviewSchema = z.object({
  path: z.string(),
  content: z.string(),
  version: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
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

export async function fetchConversationDraft(
  conversationId: string,
  path: string,
  run: DraftPreviewFetch = defaultFetch,
): Promise<ConversationDraftPreview> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/draft?path=${encodeURIComponent(path)}`
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
