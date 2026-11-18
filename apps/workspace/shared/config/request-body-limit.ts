export const BYTES_PER_MB = 1e6

export const DEFAULT_MAX_IFC_BYTES = 250 * BYTES_PER_MB

export const DEFAULT_MAX_DOCUMENT_BYTES = 100 * BYTES_PER_MB

function positive(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function maxIfcBytesFrom(env: Record<string, string | undefined>): number {
  return positive(env.BIM_MAX_IFC_BYTES) ?? DEFAULT_MAX_IFC_BYTES
}

export function maxDocumentBytesFrom(env: Record<string, string | undefined>): number {
  const megabytes = positive(env.FILE_UPLOAD_MAX_SIZE_MB)
  return megabytes === null ? DEFAULT_MAX_DOCUMENT_BYTES : megabytes * BYTES_PER_MB
}

export function requestBodyLimitBytes(
  env: Record<string, string | undefined> = process.env
): number {
  return Math.max(maxDocumentBytesFrom(env), maxIfcBytesFrom(env))
}
