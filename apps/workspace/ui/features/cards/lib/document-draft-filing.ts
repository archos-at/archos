import { z } from 'zod'

export const draftFileResponseSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  state: z.string().min(1),
  alreadyFiled: z.boolean(),
  folderId: z.string().nullable().optional(),
  folderName: z.string().nullable().optional(),
})

export type DraftFileResponse = z.infer<typeof draftFileResponseSchema>

export type DraftFileFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: DraftFileFetch = (path, init) => fetch(path, init)

export class DraftFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DraftFileError'
  }
}

export interface DraftDestination {
  folderId: string | null
  name: string
}

export interface FileDraftInput {
  path: string
  title: string
  force?: boolean
  destination?: DraftDestination
}

export async function fileConversationDraft(
  conversationId: string,
  input: FileDraftInput,
  run: DraftFileFetch = defaultFetch,
): Promise<DraftFileResponse> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/draft/file`
  const response = await run(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: input.path,
      title: input.title,
      force: input.force ?? false,
      ...(input.destination ? { folderId: input.destination.folderId, name: input.destination.name } : {}),
    }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string; details?: unknown }
    throw new DraftFileError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      error.details,
    )
  }
  return draftFileResponseSchema.parse(body)
}
