import { FOLDER_READ_ONLY_REASON } from '@/lib/authz/folder-access-rule'
import { isProjectClosedBody } from '@/lib/projects/project-status'
import { isNameTakenBody } from '@/lib/documents/name-taken'
import { XhrUploadError } from '@/lib/http/xhr-upload'
import { isQuarantinedReplaceBody } from '@/lib/upload-screening/quarantine'
import type { NameMatch } from '@/lib/upload-screening/name-screen'
import { nameStopMatchesOf } from '@/lib/upload-screening/name-stop'

const SCREENING_UNAVAILABLE_CODE = 'UPLOAD_SCREENING_UNAVAILABLE'

const CHANGED_MEANWHILE_REASONS: ReadonlySet<string> = new Set([
  'live_name_taken',
  'replaced_document_gone',
  'deleted_during_upload',
])

export type UploadRefusal =
  | { kind: 'held-replace'; documentId: string | null; ownUpload: boolean }
  | { kind: 'name-taken' }
  | { kind: 'name-stop'; matches: NameMatch[] }
  | { kind: 'project-closed' }
  | { kind: 'screening-unavailable' }
  | { kind: 'folder-read-only' }
  | { kind: 'changed-meanwhile' }
  | { kind: 'too-large'; limitBytes: number | null }
  | { kind: 'storage-full' }
  | { kind: 'invalid-type'; accepted: string[] }
  | { kind: 'other' }

function parseBody(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    return null
  }
}

function reasonOf(body: unknown): unknown {
  const details = (body as { details?: unknown } | null)?.details
  return details && typeof details === 'object' ? (details as { reason?: unknown }).reason : undefined
}

function detailsOf(body: unknown): Record<string, unknown> {
  const details = (body as { details?: unknown } | null)?.details
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : {}
}

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

function refusalByCode(status: number, body: unknown): UploadRefusal | null {
  const code = (body as { code?: unknown } | null)?.code
  const details = detailsOf(body)
  if (code === 'FILE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE' || status === 413) {
    return { kind: 'too-large', limitBytes: positive(details.maxSizeBytes) ?? positive(details.limitBytes) }
  }
  if (code === 'STORAGE_QUOTA_EXCEEDED' || status === 507) return { kind: 'storage-full' }
  const accepted = details.accepted
  if (Array.isArray(accepted) && accepted.every((type) => typeof type === 'string')) {
    return { kind: 'invalid-type', accepted }
  }
  return null
}

function heldReplaceOf(body: unknown): UploadRefusal {
  const details = (body as { details: { documentId?: unknown; ownUpload?: unknown } }).details
  return {
    kind: 'held-replace',
    documentId: typeof details.documentId === 'string' && details.documentId ? details.documentId : null,
    ownUpload: details.ownUpload === true,
  }
}

export function uploadRefusalOf(error: unknown): UploadRefusal | null {
  if (!(error instanceof XhrUploadError)) return null
  const body = parseBody(error.responseText)
  if (error.status === 409 && isQuarantinedReplaceBody(body)) return heldReplaceOf(body)
  if (isNameTakenBody(body)) return { kind: 'name-taken' }
  const matches = nameStopMatchesOf(body)
  if (matches) return { kind: 'name-stop', matches }
  if (isProjectClosedBody(body)) return { kind: 'project-closed' }
  if ((body as { code?: unknown } | null)?.code === SCREENING_UNAVAILABLE_CODE) return { kind: 'screening-unavailable' }
  const reason = reasonOf(body)
  if (reason === FOLDER_READ_ONLY_REASON) return { kind: 'folder-read-only' }
  if (typeof reason === 'string' && CHANGED_MEANWHILE_REASONS.has(reason)) return { kind: 'changed-meanwhile' }
  return refusalByCode(error.status, body) ?? { kind: 'other' }
}

export function mayRetryRefusal(refusal: UploadRefusal | null): boolean {
  if (!refusal) return true
  return (
    refusal.kind === 'changed-meanwhile' ||
    refusal.kind === 'screening-unavailable' ||
    refusal.kind === 'storage-full' ||
    refusal.kind === 'other'
  )
}
