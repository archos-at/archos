import { z } from 'zod'
import { surfaceStateOf, type SurfaceState } from '@/lib/documents/surface-state'
import { verdictSchema } from '@/lib/upload-screening/quarantine'
import type { FileInfo, ListedFileStatus } from './documents-schemas'

const SessionDocumentRowSchema = z.object({
  id: z.string(),
  filename: z.string(),
  fileSize: z.number().nullable().optional(),
  status: z.string(),
  collectionName: z.string(),
  createdAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  quarantine: verdictSchema.nullable().catch(null).optional(),
  chunkCount: z.number().nullable().optional(),
})

const SessionDocumentListSchema = z.object({
  documents: z.array(SessionDocumentRowSchema),
  collectionName: z.string(),
})

export type SessionDocumentRow = z.infer<typeof SessionDocumentRowSchema>

const LISTED_STATUS_BY_STATE: Record<SurfaceState, ListedFileStatus> = {
  citable: 'success',
  uploading: 'ingesting',
  reading: 'ingesting',
  held: 'held',
  unreadable: 'failed',
  stored: 'stored',
  cancelled: 'stored',
  unknown: 'stored',
}

export function sessionDocumentFileStatus(status: string): ListedFileStatus {
  return LISTED_STATUS_BY_STATE[surfaceStateOf(status)]
}

export function sessionDocumentToFileInfo(row: SessionDocumentRow): FileInfo {
  return {
    file_id: row.id,
    file_name: row.filename,
    collection_name: row.collectionName,
    status: sessionDocumentFileStatus(row.status),
    file_size: row.fileSize ?? null,
    chunk_count: row.chunkCount ?? 0,
    uploaded_at: row.createdAt ?? null,
    error_message: row.errorMessage ?? null,
    quarantine: row.quarantine ?? null,
    metadata: {},
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' && message ? message : `${fallback}: ${response.status}`
}

export async function listSessionDocuments(
  conversationId: string,
  signal?: AbortSignal
): Promise<FileInfo[] | null> {
  const response = await fetch(
    `/api/session/documents?conversationId=${encodeURIComponent(conversationId)}`,
    { signal }
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await errorMessage(response, 'Failed to list attachments'))
  const { documents } = SessionDocumentListSchema.parse(await response.json())
  return documents.map(sessionDocumentToFileInfo)
}

export async function deleteSessionDocument(documentId: string): Promise<void> {
  const response = await fetch(`/api/session/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  })
  if (response.ok || response.status === 404) return
  throw new Error(await errorMessage(response, 'Failed to delete attachment'))
}
