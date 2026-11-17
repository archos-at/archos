import type { FileItem } from './project-file-workspace'
import { isOlderRevisionEntry } from './revision-badge'
import { documentBadgeState } from '../lib/document-lifecycle'

export interface FileListColumns {
  approval: boolean
  pages: boolean
  size: boolean
}

export function approvalSubjectOf(file: FileItem) {
  return {
    versionState: file.versionState ?? null,
    versionCount: file.versionCount ?? null,
    lifecycle: file.lifecycle ?? undefined,
    authoredBy: file.authoredBy ?? null,
  }
}

export function listColumns(files: readonly FileItem[]): FileListColumns {
  return {
    approval: files.some((file) => isOlderRevisionEntry(file) || documentBadgeState(approvalSubjectOf(file)) !== null),
    pages: files.some((file) => file.pageCount !== null && file.pageCount !== undefined),
    size: files.some((file) => typeof file.fileSize === 'number'),
  }
}
