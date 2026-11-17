import type { DocumentReadFamily } from './document-status'

export type ShelfFolderTally = { folderId: string | null; total: number; latest: string | null } & Record<
  DocumentReadFamily,
  number
>

export interface ShelfSummary {
  folders: ShelfFolderTally[]
  failed: Array<{ id: string; folderId: string | null }>
  failedTruncated: boolean
}

export const SHELF_SUMMARY_FAILED_LIMIT = 1000

export const SHELF_SUMMARY_FOLDER_LIMIT = 10_000
