import { z } from 'zod'
import type {
  InboxItemType,
  InboxItemView,
  InboxListFilter,
  InboxListResponse,
  InboxMutationResult,
  InboxSummaryResponse,
} from './types'

export type InboxFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: InboxFetch = (path, init) => fetch(path, init)

const BASE = '/api/inbox'

export const INBOX_READ_PATH = `${BASE}/read`

export class InboxRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'InboxRequestError'
  }
}

const mutationResultSchema = z.object({ affected: z.number(), pending: z.number() })
const unreadAnchorsSchema = z.object({ anchorIds: z.array(z.string()) })
const summarySchema = z.object({ pending: z.number() })
const itemSchema = z.custom<InboxItemView>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { type?: unknown }).type === 'string'
)
const listSchema: z.ZodType<InboxListResponse> = z.object({
  items: z.array(itemSchema),
  pending: z.number(),
  counts: z.object({ requests: z.number(), unread: z.number() }),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})

export interface ListInboxQuery {
  filter?: InboxListFilter
  cursor?: string | null
  type?: InboxItemType
  projectId?: string
  limit?: number
}

export interface MarkRef {
  documentId: string
  annotationId: string
}

export interface InboxClient {
  list(query?: ListInboxQuery): Promise<InboxListResponse>
  summary(): Promise<InboxSummaryResponse>
  markRead(itemIds: readonly string[]): Promise<InboxMutationResult>
  markAllRead(): Promise<InboxMutationResult>
  markMarkRead(mark: MarkRef): Promise<InboxMutationResult>
  markMarksSetRead(documentId: string): Promise<InboxMutationResult>
  unreadMarks(documentId: string): Promise<string[]>
  markUnread(itemIds: readonly string[]): Promise<InboxMutationResult>
  archive(itemId: string): Promise<InboxMutationResult>
  unarchive(itemId: string): Promise<InboxMutationResult>
}

export function createInboxClient(request: InboxFetch = defaultFetch): InboxClient {
  async function call<T>(path: string, init: RequestInit | undefined, schema: z.ZodType<T>): Promise<T> {
    const response = await request(path, {
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    if (!response.ok) {
      throw new InboxRequestError(response.status, `${init?.method ?? 'GET'} ${path} answered ${response.status}`)
    }
    const parsed = schema.safeParse(await response.json())
    if (!parsed.success) throw new InboxRequestError(502, `${path} answered a shape this client does not know`)
    return parsed.data
  }

  const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
  const itemPath = (itemId: string) => `${BASE}/${encodeURIComponent(itemId)}/archive`

  return {
    list: async ({ filter = 'all', cursor, type, projectId, limit } = {}) => {
      const params = new URLSearchParams({ filter })
      if (cursor) params.set('cursor', cursor)
      if (type) params.set('type', type)
      if (projectId) params.set('projectId', projectId)
      if (limit) params.set('limit', String(limit))
      return call(`${BASE}?${params.toString()}`, undefined, listSchema)
    },
    summary: () => call(`${BASE}/summary`, undefined, summarySchema),
    markRead: (itemIds) => call(INBOX_READ_PATH, post({ itemIds }), mutationResultSchema),
    markAllRead: () => call(INBOX_READ_PATH, post({ all: true }), mutationResultSchema),
    markMarkRead: ({ documentId, annotationId }) =>
      call(
        INBOX_READ_PATH,
        post({ resourceType: 'document', resourceId: documentId, anchorId: annotationId }),
        mutationResultSchema
      ),
    markMarksSetRead: (documentId) =>
      call(INBOX_READ_PATH, post({ resourceType: 'document', resourceId: documentId, marksSet: true }), mutationResultSchema),
    unreadMarks: async (documentId) => {
      const params = new URLSearchParams({ resourceType: 'document', resourceId: documentId })
      return (await call(`${BASE}/unread-anchors?${params.toString()}`, undefined, unreadAnchorsSchema)).anchorIds
    },
    markUnread: (itemIds) => call(`${BASE}/unread`, post({ itemIds }), mutationResultSchema),
    archive: (itemId) => call(itemPath(itemId), { method: 'POST' }, mutationResultSchema),
    unarchive: (itemId) => call(itemPath(itemId), { method: 'DELETE' }, mutationResultSchema),
  }
}

export const inboxClient: InboxClient = createInboxClient()
