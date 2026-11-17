export const DOWNLOAD_LOG_KINDS = ['download', 'preview', 'pdf', 'text', 'version', 'model'] as const
export type DownloadLogKind = (typeof DOWNLOAD_LOG_KINDS)[number]

export function isOpenKind(kind: DownloadLogKind): boolean {
  return kind !== 'download'
}

export const DOWNLOAD_LOG_SCOPES = ['project', 'office_shelf', 'session'] as const
export type DownloadLogScope = (typeof DOWNLOAD_LOG_SCOPES)[number]

export const DOWNLOAD_LOG_STORED_SCOPES = [...DOWNLOAD_LOG_SCOPES, 'archiv'] as const

export const DOWNLOAD_LOG_DEFAULT_RETENTION_DAYS = 365
export const DOWNLOAD_LOG_MIN_RETENTION_DAYS = 30
export const DOWNLOAD_LOG_MAX_RETENTION_DAYS = 365

export const DOWNLOAD_LOG_RETENTION_SETTING = 'downloadLogRetentionDays'

export function isValidRetentionDays(days: unknown): days is number {
  return (
    typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= DOWNLOAD_LOG_MIN_RETENTION_DAYS &&
    days <= DOWNLOAD_LOG_MAX_RETENTION_DAYS
  )
}

export function retentionDaysFromSettings(settings: Record<string, unknown>): number {
  const value = settings[DOWNLOAD_LOG_RETENTION_SETTING]
  return isValidRetentionDays(value) ? value : DOWNLOAD_LOG_DEFAULT_RETENTION_DAYS
}

export const ACCESS_LOG_DEFAULT_LIMIT = 50
export const ACCESS_LOG_MAX_LIMIT = 100
