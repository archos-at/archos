import { ROOM_PEER_HEADER } from './peer-header'
import {
  projectMarksHref,
  projectMarksResponseSchema,
  type ProjectMarksFilters,
  type ProjectMarksResponse,
} from './project-types'
import {
  annotationListResponseSchema,
  annotationResponseSchema,
  documentThreadResponseSchema,
  replyResponseSchema,
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationView,
  type CreateAnnotationRequest,
  type CreateReplyRequest,
  type ReplyResponse,
  type UpdateAnnotationRequest,
  type UpdateReplyRequest,
} from './types'

export type AnnotationFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: AnnotationFetch = (path, init) => fetch(path, init)

export class AnnotationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly reason: string | null = null
  ) {
    super(message)
    this.name = 'AnnotationRequestError'
  }
}

async function request<T>(
  run: AnnotationFetch,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T
): Promise<T> {
  const response = await run(path, init)
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string; details?: { reason?: unknown } }
    const reason = typeof error.details?.reason === 'string' ? error.details.reason : null
    throw new AnnotationRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      reason
    )
  }
  return parse(body)
}

export interface WriteOptions {
  peerId?: string | null
  run?: AnnotationFetch
}

const json = (method: string, payload: unknown, peerId?: string | null): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...(peerId ? { [ROOM_PEER_HEADER]: peerId } : {}) },
  body: JSON.stringify(payload),
})

const documentPath = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}`
export const annotationsPath = (documentId: string) => `${documentPath(documentId)}/annotations`
const annotationPath = (documentId: string, annotationId: string) =>
  `${annotationsPath(documentId)}/${encodeURIComponent(annotationId)}`

const one = (value: unknown) => annotationResponseSchema.parse(value).annotation

export function listAnnotations(
  documentId: string,
  run: AnnotationFetch = defaultFetch
): Promise<AnnotationListResponse> {
  return request(run, annotationsPath(documentId), { method: 'GET' }, (value) =>
    annotationListResponseSchema.parse(value)
  )
}

export function getAnnotation(
  documentId: string,
  annotationId: string,
  run: AnnotationFetch = defaultFetch
): Promise<AnnotationView> {
  return request(run, annotationPath(documentId, annotationId), { method: 'GET' }, one)
}

export function createAnnotation(
  documentId: string,
  input: CreateAnnotationRequest,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<AnnotationView> {
  return request(run, annotationsPath(documentId), json('POST', input, peerId), one)
}

export function updateAnnotation(
  documentId: string,
  annotationId: string,
  input: UpdateAnnotationRequest,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<AnnotationView> {
  return updateAnnotationWithWake(documentId, annotationId, input, { peerId, run }).then(({ annotation }) => annotation)
}

export function updateAnnotationWithWake(
  documentId: string,
  annotationId: string,
  input: UpdateAnnotationRequest,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<AnnotationResponse> {
  return request(run, annotationPath(documentId, annotationId), json('PATCH', input, peerId), (value) =>
    annotationResponseSchema.parse(value)
  )
}

export function replyToAnnotation(
  documentId: string,
  annotationId: string,
  input: CreateReplyRequest,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<ReplyResponse> {
  return request(run, `${annotationPath(documentId, annotationId)}/replies`, json('POST', input, peerId), (value) =>
    replyResponseSchema.parse(value)
  )
}

const replyPath = (documentId: string, annotationId: string, replyId: string) =>
  `${annotationPath(documentId, annotationId)}/replies/${encodeURIComponent(replyId)}`

export function editReply(
  documentId: string,
  annotationId: string,
  replyId: string,
  input: UpdateReplyRequest,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<AnnotationView> {
  return request(run, replyPath(documentId, annotationId, replyId), json('PATCH', input, peerId), one)
}

export function deleteReply(
  documentId: string,
  annotationId: string,
  replyId: string,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<void> {
  return request(
    run,
    replyPath(documentId, annotationId, replyId),
    { method: 'DELETE', headers: peerId ? { [ROOM_PEER_HEADER]: peerId } : {} },
    () => undefined
  )
}

export function documentThread(
  documentId: string,
  { title, run = defaultFetch }: { title?: string; run?: AnnotationFetch } = {}
): Promise<string> {
  return request(
    run,
    `${documentPath(documentId)}/thread`,
    json('POST', title ? { title } : {}),
    (value) => documentThreadResponseSchema.parse(value).conversationId
  )
}

export function deleteAnnotation(
  documentId: string,
  annotationId: string,
  { peerId, run = defaultFetch }: WriteOptions = {}
): Promise<void> {
  return request(
    run,
    annotationPath(documentId, annotationId),
    { method: 'DELETE', headers: peerId ? { [ROOM_PEER_HEADER]: peerId } : {} },
    () => undefined
  )
}

export function listProjectAnnotations(
  projectId: string,
  filters: ProjectMarksFilters = {},
  { limit, cursor, run = defaultFetch }: { limit?: number; cursor?: string | null; run?: AnnotationFetch } = {}
): Promise<ProjectMarksResponse> {
  return request(run, projectMarksHref(projectId, filters, { limit, cursor }), { method: 'GET' }, (value) =>
    projectMarksResponseSchema.parse(value)
  )
}
