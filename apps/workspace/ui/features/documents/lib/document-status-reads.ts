import { documentReadFamily, documentStatusFacts } from '@/lib/documents/document-status'
import type { FileItem } from '../components/project-file-workspace'
import type { TrackedFile } from '../types'
import { refreshedFileFields } from './file-item'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'

export const STATUS_READ_BATCH = 24

export const STATUS_READ_CONCURRENCY = 6

export const STATUS_FIELDS: readonly (keyof FileItem)[] = [
  'status',
  'errorMessage',
  'quarantine',
  'summary',
  'pageCount',
  'chunkCount',
  'contentTypes',
  'tags',
  'versionCount',
  'queueAhead',
]

export type DocumentStatusRead = { kind: 'row'; fields: Partial<FileItem> } | { kind: 'gone' }

function statusFields(body: Record<string, unknown>): Partial<FileItem> {
  const fields: Record<string, unknown> = {}
  for (const field of STATUS_FIELDS) {
    if (field in body) fields[field] = body[field]
  }
  return fields as Partial<FileItem>
}

async function readOne(id: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<DocumentStatusRead | null> {
  try {
    const response = await fetcher(`/api/documents/${encodeURIComponent(id)}/status`, { signal })
    if (response.status === 404) return { kind: 'gone' }
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return null
    const record = body as Record<string, unknown>
    if (typeof record.status !== 'string') return null
    return { kind: 'row', fields: statusFields(record) }
  } catch {
    return null
  }
}

export async function readDocumentStatuses(
  ids: readonly string[],
  { fetcher = fetch, signal, concurrency = STATUS_READ_CONCURRENCY }: {
    fetcher?: typeof fetch
    signal?: AbortSignal
    concurrency?: number
  } = {}
): Promise<Map<string, DocumentStatusRead>> {
  const reads = new Map<string, DocumentStatusRead>()
  const queue = [...new Set(ids)]
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (signal?.aborted) return
      const read = await readOne(id, fetcher, signal)
      if (read) reads.set(id, read)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
  return reads
}

export function nextStatusBatch(
  ids: readonly string[],
  offset: number,
  size: number = STATUS_READ_BATCH
): { batch: string[]; next: number } {
  if (ids.length <= size) return { batch: [...ids], next: 0 }
  const start = offset % ids.length
  const batch = Array.from({ length: size }, (_, i) => ids[(start + i) % ids.length])
  return { batch, next: (start + size) % ids.length }
}

export function mergeStatusReads<T extends FileItem>(
  rows: readonly T[],
  reads: ReadonlyMap<string, DocumentStatusRead>
): T[] {
  if (reads.size === 0) return rows as T[]
  let changed = false
  const merged: T[] = []
  for (const row of rows) {
    const read = reads.get(row.id)
    if (!read) {
      merged.push(row)
      continue
    }
    if (read.kind === 'gone') {
      changed = true
      continue
    }
    const patch = refreshedFileFields(row, read.fields)
    if (!patch) {
      merged.push(row)
      continue
    }
    changed = true
    merged.push({ ...row, ...patch })
  }
  return changed ? merged : (rows as T[])
}

export function isJoblessIngesting(upload: TrackedFile): boolean {
  return upload.status === 'ingesting' && !upload.jobId && !!upload.serverFileId
}

export function trackedPatchFromStatus(
  status: string | null | undefined,
  errorMessage?: string | null,
  quarantine?: QuarantineVerdict | null
): Partial<TrackedFile> | null {
  if (documentStatusFacts(status)?.phase !== 'terminal') return null
  switch (documentReadFamily(status)) {
    case 'readable':
      return { status: 'success', progress: 100 }
    case 'failed':
      return { status: 'failed', ...(errorMessage ? { errorMessage } : {}) }
    case 'held':
      return { status: 'held', ...(errorMessage ? { errorMessage } : {}), ...(quarantine ? { quarantine } : {}) }
    case 'unindexed':
      return { status: 'stored', progress: 100 }
    case 'reading':
      return null
  }
}
