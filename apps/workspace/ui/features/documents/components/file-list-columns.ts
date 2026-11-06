/**
 * Which of the list's optional columns carry anything for these rows.
 *
 * A column that reads „—“ or nothing on every row is noise the eye still has
 * to cross: Status is silent for every readable document, Freigabe for every
 * plain upload, Seiten for every file without pages, Größe for a search. Each steps in when one row
 * has something to say, so a list of fresh uploads is name, size and date.
 */

import type { FileItem } from './project-file-workspace'
import { isCitableStatus } from './document-status'
import { isOlderRevisionEntry } from './revision-badge'
import { documentBadgeState } from '../lib/document-lifecycle'

export interface FileListColumns {
  status: boolean
  approval: boolean
  pages: boolean
  /** A search hit carries no size: a column of „—“ is no column. */
  size: boolean
}

/** The badge rule's subject, with the listing's nulls narrowed to what the rule reads (`null` lifecycle is the working set). */
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
    status: files.some((file) => file.status !== undefined && file.status !== null && !isCitableStatus(file.status)),
    approval: files.some((file) => isOlderRevisionEntry(file) || documentBadgeState(approvalSubjectOf(file)) !== null),
    pages: files.some((file) => file.pageCount !== null && file.pageCount !== undefined),
    size: files.some((file) => typeof file.fileSize === 'number'),
  }
}
