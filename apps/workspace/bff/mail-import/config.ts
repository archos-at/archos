export const MAIL_ARCHIVE_EXTENSIONS = ['.pst', '.ost'] as const

export const MAIL_IMPORT_PART_BYTES = 32 * 1024 * 1024

export const MAX_MULTIPART_PARTS = 10_000

const DEFAULT_MAX_ARCHIVE_BYTES = 25e9

export function maxArchiveBytes(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.MAIL_IMPORT_MAX_BYTES ?? '', 10)
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ARCHIVE_BYTES
  return Math.min(value, MAIL_IMPORT_PART_BYTES * MAX_MULTIPART_PARTS)
}

export const MAIL_IMPORT_ROOT_FOLDER = 'E-Mail-Import'

export const MAIL_IMPORT_PAGE_SIZE = 20

export const MAIL_IMPORT_SLICE_BUDGET_MS = 120_000

export const MAIL_IMPORT_RENDER_BUDGET_MS = 20_000

export const MAIL_ARCHIVE_READ_TIMEOUT_MS = 90_000

export const MAIL_IMPORT_RETRY_BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120] as const

export const STALE_UPLOAD_HOURS = 48

export const STALLED_IMPORT_MINUTES = 30

export const SKIPPED_SAMPLES_KEPT = 20

export const ARCHIVE_URL_TTL_SECONDS = 60 * 60
