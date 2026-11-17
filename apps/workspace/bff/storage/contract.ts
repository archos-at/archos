import { z } from 'zod'
import { BYTES_PER_MB } from '@/shared/config/request-body-limit'

export const BYTES_PER_GB = 1e9

export const MAX_QUOTA_BYTES = Number.MAX_SAFE_INTEGER

export const storageQuotaPutSchema = z.object({
  quotaBytes: z.number().int().positive().max(MAX_QUOTA_BYTES).nullable(),
})

export type StorageQuotaPut = z.infer<typeof storageQuotaPutSchema>

export type QuotaDraftRejection = 'notANumber' | 'notPositive' | 'tooLarge'

export type QuotaDraft =
  | { ok: true; quotaBytes: number | null }
  | { ok: false; reason: QuotaDraftRejection }

export function parseQuotaDraft(raw: string): QuotaDraft {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, quotaBytes: null }

  const gb = Number(trimmed)
  if (Number.isNaN(gb)) return { ok: false, reason: 'notANumber' }

  const quotaBytes = Math.round(gb * BYTES_PER_GB)
  if (storageQuotaPutSchema.safeParse({ quotaBytes }).success) {
    return { ok: true, quotaBytes }
  }

  return { ok: false, reason: quotaBytes > 0 ? 'tooLarge' : 'notPositive' }
}

export function formatQuotaDraft(quotaBytes: number): string {
  return String(quotaBytes / BYTES_PER_GB)
}

export { BYTES_PER_MB }

export const MIN_UPLOAD_LIMIT_BYTES = BYTES_PER_MB

export const uploadLimitPutSchema = z.object({
  maxUploadFileBytes: z.number().int().min(MIN_UPLOAD_LIMIT_BYTES).max(MAX_QUOTA_BYTES).nullable(),
})

export type UploadLimitPut = z.infer<typeof uploadLimitPutSchema>

export type UploadLimitRejection = 'notANumber' | 'outOfRange'

export type UploadLimitDraft =
  | { ok: true; maxUploadFileBytes: number | null }
  | { ok: false; reason: UploadLimitRejection }

export function judgeUploadLimitMegabytes(
  megabytes: number | null,
  ceilingBytes: number
): UploadLimitDraft {
  if (megabytes === null) return { ok: true, maxUploadFileBytes: null }
  if (!Number.isFinite(megabytes)) return { ok: false, reason: 'notANumber' }
  return judgeUploadLimitBytes(Math.round(megabytes * BYTES_PER_MB), ceilingBytes)
}

export function judgeUploadLimitBytes(bytes: number, ceilingBytes: number): UploadLimitDraft {
  const inSchema = uploadLimitPutSchema.safeParse({ maxUploadFileBytes: bytes }).success
  if (!inSchema || bytes > ceilingBytes) return { ok: false, reason: 'outOfRange' }
  return { ok: true, maxUploadFileBytes: bytes }
}
