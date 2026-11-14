/** What a document preview is given (`FilePreviewPane`, read by `useFilePreviewController`). */

import type { ReactNode } from 'react'
import type { MarkTally } from '@/lib/annotations/types'
import type { DocumentLifecyclePermission, DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { DocumentScope } from './document-actions'
import type { FileItem } from './project-file-workspace'

export interface FilePreviewPaneProps {
  file: FileItem
  /** Present for project documents; omitted for the org-wide Archiv (unused here). */
  projectId?: string
  /** Project display name for the indexed-metadata panel's Project row. */
  projectName?: string
  /**
   * Whether the viewer may mutate the document (edit tags, re-ingest). Defaults
   * to true (all project callers). The Archiv passes the caller's manage
   * capability so members without `org:office_shelf:manage` get a read-only pane.
   */
  canManage?: boolean
  onClose?: () => void
  /** Notify the parent to flip local state after a successful re-ingestion. */
  onReingested?: (fileId: string, status: string) => void
  /**
   * Notify the parent of the saved tags after a successful PATCH, so the
   * workspace's file state (and thus `initialTags` on reselect) stays fresh —
   * otherwise switching away and back reverts to the pre-edit tags.
   */
  onTagsUpdated?: (fileId: string, tags: string[], topics?: string[]) => void
  /** Open another document of this shelf here, from the Fassungen section. */
  onOpenDocument?: (fileId: string) => void
  /** A link was confirmed or taken back: the Fassung facts of one of the two documents, so the listing moves both cards. */
  onRevisionChanged?: (fileId: string, revision: RevisionLinks | null) => void
  /**
   * Whether the indexed-metadata panel (AI summary, key-value props,
   * editable tags) renders (FB-8). On by default, the chat peek included,
   * where it is the Details tab. Status/type/size rows always render.
   */
  showMetadataPanel?: boolean
  /**
   * Whether an `.ifc` preview offers the model workspace (`ifc-models`).
   *
   * Defaults to true: a link that does not
   * render is a feature nobody can find, and the workspace refuses on its own
   * if the flag is really off.
   */
  showModels?: boolean
  /** Which corpus the document belongs to — decides the file operations' route. */
  scope?: DocumentScope
  /** The document was renamed from the header menu. */
  onRenamed?: (fileId: string, displayName: string | null) => void
  /** The document was deleted from the header menu; the pane closes itself. */
  onDeleted?: (fileId: string) => void
  canCollaborate?: boolean
  /**
   * What this reader may do to the document's versions, resolved on the server
   * (`lib/documents/lifecycle-permissions.ts`). Absent means the surface did not
   * read them — the Archiv sheet, the chat peek — and the rail then shows no
   * Freigabe section at all rather than guessing a set.
   */
  lifecyclePermissions?: readonly DocumentLifecyclePermission[]
  /** The reader, so their own acts in the version list read as „Sie". */
  viewerUserId?: string | null
  /** A Freigabe decision landed — the listing behind the pane moves its badge. */
  onLifecycleChanged?: (
    fileId: string,
    summary: { versionState: DocumentVersionState; versionCount: number },
  ) => void
  /**
   * The review read the marks, or the reader changed them: the listing's tally
   * for this document, as the server counts it (`tallyLiveMarks`), `null` when
   * none is live. Dateien's chip is read with the listing and would otherwise
   * say „5 offen“ after the reader closed all five here.
   */
  onMarksChanged?: (fileId: string, marks: MarkTally | null) => void
  /** Modal on Files; peek/expanded once this file is the chat subject. */
  presentation?: 'modal' | 'peek' | 'expanded'
  onAssigneesChanged?: (assignees: FileItem['assignees']) => void
  /**
   * What the surface that opened the file knows about it beyond the file, first in the details column: Grundlagen
   * des Büros puts the standard's edition, validity and last check here, so a standard opens as the file it is and
   * its facts read beside it rather than in a form of their own.
   */
  detailsLead?: ReactNode
}
