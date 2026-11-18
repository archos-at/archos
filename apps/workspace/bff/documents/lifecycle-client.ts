import {
  documentArchiveResponseSchema,
  documentVersionDiffResponseSchema,
  documentVersionListResponseSchema,
  documentVersionResponseSchema,
  type DocumentArchiveResponse,
  type DocumentVersionDiffResponse,
  type DocumentVersionListResponse,
  type DocumentVersionView,
} from './lifecycle-types'

export type LifecycleFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: LifecycleFetch = (path, init) => fetch(path, init)

export class DocumentLifecycleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DocumentLifecycleError'
  }
}

async function request<T>(
  run: LifecycleFetch,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await run(path, init)
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string; details?: unknown }
    throw new DocumentLifecycleError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      error.details,
    )
  }
  return parse(body)
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface DocumentLifecycleClient {
  listVersions(documentId: string): Promise<DocumentVersionListResponse>
  getVersion(documentId: string, versionId: string): Promise<DocumentVersionView>
  forkDraft(documentId: string): Promise<DocumentVersionView>
  replaceContent(
    documentId: string,
    versionId: string,
    content: string,
    ifMatch: string,
  ): Promise<DocumentVersionView>
  submit(
    documentId: string,
    versionId: string,
    reviewerUserIds?: readonly string[],
    options?: { orderMessage?: string; dueAt?: string },
  ): Promise<DocumentVersionView>
  approve(
    documentId: string,
    versionId: string,
    comment?: string,
    ifMatch?: string,
  ): Promise<DocumentVersionView>
  requestChanges(
    documentId: string,
    versionId: string,
    comment: string,
    delegateRevision?: boolean,
    ifMatch?: string,
  ): Promise<DocumentVersionView>
  reject(
    documentId: string,
    versionId: string,
    comment: string,
    ifMatch?: string,
  ): Promise<DocumentVersionView>
  publish(documentId: string, versionId: string): Promise<DocumentVersionView>
  archive(documentId: string): Promise<DocumentArchiveResponse>
  diff(documentId: string, from: string, to: string): Promise<DocumentVersionDiffResponse>
}

export function createDocumentLifecycleClient(
  run: LifecycleFetch = defaultFetch,
): DocumentLifecycleClient {
  const versions = (documentId: string) => `/api/documents/${documentId}/versions`
  const version = (documentId: string, versionId: string) =>
    `${versions(documentId)}/${versionId}`
  const one = (value: unknown) => documentVersionResponseSchema.parse(value).version

  return {
    listVersions: (documentId) =>
      request(run, versions(documentId), { method: 'GET' }, (value) =>
        documentVersionListResponseSchema.parse(value),
      ),

    getVersion: (documentId, versionId) =>
      request(run, version(documentId, versionId), { method: 'GET' }, one),

    forkDraft: (documentId) => request(run, versions(documentId), json({}), one),

    replaceContent: (documentId, versionId, content, ifMatch) =>
      request(
        run,
        `${version(documentId, versionId)}/content`,
        { ...json({ content, ifMatch }), method: 'PUT' },
        one,
      ),

    submit: (documentId, versionId, reviewerUserIds = [], options = {}) => {
      const body: { reviewerUserIds: string[]; orderMessage?: string; dueAt?: string } = {
        reviewerUserIds: [...reviewerUserIds],
      }
      if (options.orderMessage !== undefined) body.orderMessage = options.orderMessage
      if (options.dueAt !== undefined && options.dueAt.trim() !== '') body.dueAt = options.dueAt
      return request(run, `${version(documentId, versionId)}/submit`, json(body), one)
    },

    approve: (documentId, versionId, comment, ifMatch) =>
      request(
        run,
        `${version(documentId, versionId)}/approve`,
        json({
          ...(comment === undefined ? {} : { comment }),
          ...(ifMatch === undefined ? {} : { ifMatch }),
        }),
        one,
      ),

    requestChanges: (documentId, versionId, comment, delegateRevision, ifMatch) =>
      request(
        run,
        `${version(documentId, versionId)}/changes`,
        json({
          comment,
          ...(delegateRevision ? { delegateRevision: true } : {}),
          ...(ifMatch === undefined ? {} : { ifMatch }),
        }),
        one,
      ),

    reject: (documentId, versionId, comment, ifMatch) =>
      request(
        run,
        `${version(documentId, versionId)}/reject`,
        json({ comment, ...(ifMatch === undefined ? {} : { ifMatch }) }),
        one,
      ),

    publish: (documentId, versionId) =>
      request(run, `${version(documentId, versionId)}/publish`, json({}), one),

    archive: (documentId) =>
      request(run, `/api/documents/${documentId}/archive`, json({}), (value) =>
        documentArchiveResponseSchema.parse(value),
      ),

    diff: (documentId, from, to) =>
      request(
        run,
        `${versions(documentId)}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { method: 'GET' },
        (value) => documentVersionDiffResponseSchema.parse(value),
      ),
  }
}

export const documentLifecycleClient = createDocumentLifecycleClient()

export function versionFileUrl(
  documentId: string,
  versionId: string,
  { download = false }: { download?: boolean } = {},
): string {
  const base = `/api/documents/${encodeURIComponent(documentId)}/file?versionId=${encodeURIComponent(versionId)}`
  return download ? `${base}&download=1` : base
}
