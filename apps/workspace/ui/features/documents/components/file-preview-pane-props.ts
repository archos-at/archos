import type { ReactNode } from 'react'
import type { MarkTally } from '@/lib/annotations/types'
import type { DocumentLifecyclePermission, DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { DocumentScope } from './document-actions'
import type { FileItem } from './project-file-workspace'

export interface FilePreviewPaneProps {
  file: FileItem
  projectId?: string
  projectName?: string
  canManage?: boolean
  onClose?: () => void
  onReingested?: (fileId: string, status: string) => void
  onTagsUpdated?: (fileId: string, tags: string[], topics?: string[]) => void
  onOpenDocument?: (fileId: string) => void
  onRevisionChanged?: (fileId: string, revision: RevisionLinks | null) => void
  showMetadataPanel?: boolean
  showModels?: boolean
  scope?: DocumentScope
  onRenamed?: (fileId: string, displayName: string | null) => void
  onDeleted?: (fileId: string) => void
  canCollaborate?: boolean
  lifecyclePermissions?: readonly DocumentLifecyclePermission[]
  viewerUserId?: string | null
  onLifecycleChanged?: (
    fileId: string,
    summary: { versionState: DocumentVersionState; versionCount: number },
  ) => void
  onMarksChanged?: (fileId: string, marks: MarkTally | null) => void
  presentation?: 'modal' | 'peek' | 'expanded'
  onAssigneesChanged?: (assignees: FileItem['assignees']) => void
  detailsLead?: ReactNode
}
