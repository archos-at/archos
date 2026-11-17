import type { DocumentAuthor } from '@/lib/db/schema/documents'
import type { PhotoCapture } from '@/lib/documents/photo-capture'

export function documentAskQuestion(name: string, kind: 'open' | 'keyPoints' | 'oib' = 'open'): string {
  switch (kind) {
    case 'keyPoints':
      return `Was sind die Kernaussagen in „${name}“?`
    case 'oib':
      return `Welche OIB-Stellen gelten für „${name}“?`
    default:
      return `Was steht in „${name}“?`
  }
}

export function documentQuestionHref(
  projectId: string,
  documentId: string,
  options: { ask?: string; filename?: string } = {},
): string {
  const params = new URLSearchParams({ new: '1', doc: documentId })
  if (options.ask) params.set('ask', options.ask)
  if (options.filename) params.set('file', options.filename)
  return `/app/projects/${encodeURIComponent(projectId)}/chat?${params.toString()}`
}

export function documentFilesHref(projectId: string, documentId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}/files?doc=${encodeURIComponent(documentId)}`
}

export function projectIdFromDocumentHref(href: string | null | undefined): string | null {
  if (!href) return null
  const match = /^\/app\/projects\/([^/?#]+)\/files(?:[/?#]|$)/.exec(href)
  return match ? decodeURIComponent(match[1]) : null
}

export function fileItemFromStatus(body: {
  id: string
  filename: string
  displayName?: string | null
  fileSize?: number | null
  contentType?: string | null
  status?: string | null
  createdAt?: string | Date
  errorMessage?: string | null
  summary?: string | null
  pageCount?: number | null
  chunkCount?: number | null
  contentTypes?: string[] | null
  tags?: string[] | null
  topics?: string[] | null
  capture?: PhotoCapture | null
  authoredBy?: DocumentAuthor | null
  versionCount?: number | null
}): {
  id: string
  filename: string
  displayName: string | null
  fileSize: number | null
  contentType: string | null
  status: string | null
  folderId: null
  createdAt: string
  errorMessage: string | null
  summary: string | null
  pageCount: number | null
  chunkCount: number | null
  contentTypes: string[] | null
  tags: string[] | null
  topics: string[] | null
  capture: PhotoCapture | null
  authoredBy?: DocumentAuthor
  versionCount: number | null
} {
  return {
    id: body.id,
    filename: body.filename,
    displayName: body.displayName ?? null,
    fileSize: body.fileSize ?? null,
    contentType: body.contentType ?? null,
    status: body.status ?? null,
    folderId: null,
    createdAt:
      typeof body.createdAt === 'string'
        ? body.createdAt
        : (body.createdAt?.toISOString() ?? new Date().toISOString()),
    errorMessage: body.errorMessage ?? null,
    summary: body.summary ?? null,
    pageCount: body.pageCount ?? null,
    chunkCount: body.chunkCount ?? null,
    contentTypes: body.contentTypes ?? null,
    tags: body.tags ?? null,
    topics: body.topics ?? null,
    capture: body.capture ?? null,
    versionCount: body.versionCount ?? null,
    ...(body.authoredBy ? { authoredBy: body.authoredBy } : {}),
  }
}
