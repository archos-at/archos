import { z } from 'zod'
import { DOWNLOAD_LOG_KINDS, DOWNLOAD_LOG_SCOPES } from '@/lib/download-log/kinds'
import { ApiRequestError } from './api-error'
import { PROJECT_STATUSES } from '@/lib/projects/project-status'

const EntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  userId: z.string(),
  person: z.object({ name: z.string(), email: z.string().nullable() }).nullable(),
  kind: z.enum(DOWNLOAD_LOG_KINDS),
  access: z.enum(['download', 'open']),
  scope: z.preprocess((value) => (value === 'archiv' ? 'office_shelf' : value), z.enum(DOWNLOAD_LOG_SCOPES)),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  projectStatus: z.enum(PROJECT_STATUSES).nullable().optional(),
  documentId: z.string(),
  documentName: z.string().nullable(),
  versionId: z.string().nullable(),
  folderId: z.string().nullable(),
  folderPath: z.string().nullable(),
  ownList: z.boolean(),
  nameWithheld: z.boolean(),
})

const PageSchema = z.object({
  entries: z.array(EntrySchema),
  nextCursor: z.string().nullable(),
  retentionDays: z.number().int(),
})

export type DownloadLogEntry = z.infer<typeof EntrySchema>
export type DownloadLogPage = z.infer<typeof PageSchema>

export interface DownloadLogFilters {
  userId: string
  document: string
  from: string
  to: string
  kind: string
}

export const NO_FILTERS: DownloadLogFilters = { userId: '', document: '', from: '', to: '', kind: '' }

async function requestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return new ApiRequestError(
    typeof message === 'string' && message ? message : `${fallback}: ${response.status}`,
    response.status
  )
}

export async function fetchDownloadLog(
  filters: DownloadLogFilters,
  cursor: string | null,
  signal?: AbortSignal
): Promise<DownloadLogPage> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) query.set(key, value.trim())
  }
  if (cursor) query.set('cursor', cursor)
  const response = await fetch(`/api/organization/download-log?${query.toString()}`, { signal })
  if (!response.ok) throw await requestError(response, 'Failed to load the download log')
  return PageSchema.parse(await response.json())
}

export async function saveDownloadLogRetention(days: number): Promise<{ days: number; previous: number }> {
  const response = await fetch('/api/organization/download-log/retention', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  })
  if (!response.ok) throw await requestError(response, 'Failed to save the retention')
  return z.object({ days: z.number(), previous: z.number() }).parse(await response.json())
}
