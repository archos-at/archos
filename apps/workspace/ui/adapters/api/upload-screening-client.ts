import { z } from 'zod'
import { uploadScreeningPolicySchema, type UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import {
  quarantineDecisionResultSchema,
  type QuarantineDecisionResult,
  type QuarantineDecisions,
} from '@/lib/upload-screening/decisions-wire'
import { verdictSchema } from '@/lib/upload-screening/quarantine'
import { ApiRequestError } from './api-error'

const UploadScreeningResponseSchema = z.object({
  policy: uploadScreeningPolicySchema,
  suggested: z.boolean(),
  suggestion: uploadScreeningPolicySchema,
})

const SavedUploadScreeningSchema = z.object({
  policy: uploadScreeningPolicySchema,
  suggested: z.boolean(),
})

const QuarantineFieldSchema = verdictSchema.nullable().catch(null)

const QuarantineQueueItemSchema = z.object({
  id: z.string(),
  held: z.enum(['quarantined', 'unscreened']).default('quarantined'),
  filename: z.string(),
  scope: z.preprocess((value) => (value === 'archiv' ? 'office_shelf' : value), z.enum(['project', 'office_shelf', 'session'])),
  projectId: z.string().nullable(),
  conversationId: z.string().nullable(),
  uploadedBy: z.string(),
  quarantinedAt: z.string(),
  verdict: QuarantineFieldSchema,
})

const QuarantineQueueSchema = z.object({ items: z.array(QuarantineQueueItemSchema) })

export type UploadScreeningState = z.infer<typeof UploadScreeningResponseSchema>
export type QuarantineQueueItem = z.infer<typeof QuarantineQueueItemSchema>

async function requestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  return new ApiRequestError(
    typeof message === 'string' && message ? message : `${fallback}: ${response.status}`,
    response.status
  )
}

export async function getUploadScreening(signal?: AbortSignal): Promise<UploadScreeningState> {
  const response = await fetch('/api/organization/upload-screening', { signal })
  if (!response.ok) throw await requestError(response, 'Failed to load the screening policy')
  return UploadScreeningResponseSchema.parse(await response.json())
}

export async function saveUploadScreening(
  policy: UploadScreeningPolicy
): Promise<z.infer<typeof SavedUploadScreeningSchema>> {
  const response = await fetch('/api/organization/upload-screening', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  })
  if (!response.ok) throw await requestError(response, 'Failed to save the screening policy')
  return SavedUploadScreeningSchema.parse(await response.json())
}

export async function listQuarantineQueue(signal?: AbortSignal): Promise<QuarantineQueueItem[]> {
  const response = await fetch('/api/quarantine', { signal })
  if (!response.ok) throw await requestError(response, 'Failed to load the quarantine queue')
  return QuarantineQueueSchema.parse(await response.json()).items
}

const ReleaseSchema = z.object({ status: z.string() })

export async function releaseQuarantinedDocument(documentId: string): Promise<{ status: string }> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/quarantine/release`, {
    method: 'POST',
  })
  if (!response.ok) throw await requestError(response, 'Failed to release the document')
  return ReleaseSchema.parse(await response.json())
}

const QuarantineReviewAccessSchema = z.object({ canReview: z.boolean(), canAskForReview: z.boolean() })
export type QuarantineReviewAccess = z.infer<typeof QuarantineReviewAccessSchema>

export async function getQuarantineReviewAccess(
  documentId: string,
  signal?: AbortSignal
): Promise<QuarantineReviewAccess> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/quarantine`, { signal })
  if (!response.ok) throw await requestError(response, 'Failed to read what may be done about the document')
  return QuarantineReviewAccessSchema.parse(await response.json())
}

const ReleaseRequestSchema = z.object({ id: z.string(), notified: z.number().int().nonnegative() })

export async function requestQuarantineRelease(documentId: string): Promise<{ notified: number }> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/quarantine/request-release`, {
    method: 'POST',
  })
  if (!response.ok) throw await requestError(response, 'Failed to ask for the release')
  return ReleaseRequestSchema.parse(await response.json())
}

export async function decideQuarantinedDocuments(
  decision: QuarantineDecisions['decision'],
  documentIds: readonly string[]
): Promise<QuarantineDecisionResult['results']> {
  const response = await fetch('/api/quarantine/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, documentIds }),
  })
  if (!response.ok) throw await requestError(response, 'Failed to decide about the documents')
  return quarantineDecisionResultSchema.parse(await response.json()).results
}
