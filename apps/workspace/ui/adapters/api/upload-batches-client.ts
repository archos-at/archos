import { z } from 'zod'
import { verdictSchema } from '@/lib/upload-screening/quarantine'
import { ApiRequestError } from './api-error'

export const UPLOAD_OUTCOMES = ['ready', 'reading', 'quarantined', 'failed', 'stored'] as const
export type UploadOutcome = (typeof UPLOAD_OUTCOMES)[number]

const QuarantineFieldSchema = verdictSchema.nullable().catch(null)

const UploadSummaryDocumentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  displayName: z.string().nullable(),
  folderPath: z.string().nullable(),
  status: z.string(),
  outcome: z.enum(UPLOAD_OUTCOMES),
  screening: z.enum(['clean', 'partial', 'unchecked', 'quarantined', 'released']).nullable(),
  quarantine: QuarantineFieldSchema,
  errorMessage: z.string().nullable(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  pageCount: z.number().nullable(),
  replaced: z.boolean().default(false),
  restricted: z.boolean().default(false),
})

const UploadSummarySchema = z.object({
  id: z.string(),
  scope: z.preprocess((value) => (value === 'archiv' ? 'office_shelf' : value), z.enum(['project', 'office_shelf', 'session'])),
  projectId: z.string().nullable(),
  conversationId: z.string().nullable(),
  createdAt: z.string(),
  sealedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  expectedCount: z.number(),
  unchangedCount: z.number(),
  failedCount: z.number(),
  excluded: z.array(z.object({ term: z.string(), count: z.number() })),
  documents: z.array(UploadSummaryDocumentSchema),
})

const UploadHistoryEntrySchema = z.object({
  id: z.string(),
  createdBy: z.string(),
  createdByName: z.string().nullable().default(null),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  expectedCount: z.number(),
  unchangedCount: z.number(),
  failedCount: z.number(),
  excludedCount: z.number(),
  counts: z.object({
    ready: z.number(),
    reading: z.number(),
    quarantined: z.number(),
    failed: z.number(),
    stored: z.number(),
  }),
})

const UploadHistorySchema = z.object({
  uploads: z.array(UploadHistoryEntrySchema),
  nextCursor: z.string().nullable().default(null),
})

const ProjectNameSchema = z.object({ name: z.string() })

export type UploadSummary = z.infer<typeof UploadSummarySchema>
export type UploadSummaryDocument = z.infer<typeof UploadSummaryDocumentSchema>
export type UploadScope = UploadSummary['scope']
export type UploadHistoryEntry = z.infer<typeof UploadHistoryEntrySchema>
export type UploadHistoryPage = z.infer<typeof UploadHistorySchema>

async function requestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return new ApiRequestError(
    typeof message === 'string' && message ? message : `${fallback}: ${response.status}`,
    response.status
  )
}

export async function getUploadSummary(batchId: string, signal?: AbortSignal): Promise<UploadSummary> {
  const response = await fetch(`/api/upload-batches/${encodeURIComponent(batchId)}`, { signal })
  if (!response.ok) throw await requestError(response, 'Failed to load the upload summary')
  return UploadSummarySchema.parse(await response.json())
}

export async function listProjectUploads(
  projectId: string,
  { cursor, signal }: { cursor?: string; signal?: AbortSignal } = {}
): Promise<UploadHistoryPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/uploads${query}`, { signal })
  if (!response.ok) throw await requestError(response, 'Failed to load the upload history')
  return UploadHistorySchema.parse(await response.json())
}

export async function getProjectName(projectId: string, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal })
  if (!response.ok) return null
  const parsed = ProjectNameSchema.safeParse(await response.json().catch(() => null))
  return parsed.success ? parsed.data.name : null
}
