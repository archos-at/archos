import {
  Check,
  CheckSquare,
  Download,
  FileDown,
  Folder,
  FolderInput,
  FolderTree,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Trash2,
  Ban,
  Eye,
} from 'lucide-react'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { isRenditionSource } from '@/lib/documents/preview-types'
import { isCitableStatus, isFailedStatus, isSettlingStatus } from '../document-status'
import { sortedFolderDestinations, type FolderDestination, type PathFolder } from '../../lib/folder-path-label'
import type { ActionableDocument } from './use-document-actions'

export type DocumentActionKind =
  | 'open'
  | 'ask'
  | 'select'
  | 'download'
  | 'downloadPdf'
  | 'rename'
  | 'move'
  | 'copyOriginPath'
  | 'delete'
  | 'reingest'
  | 'cancel'

export const DEFAULT_DOCUMENT_ACTIONS: readonly DocumentActionKind[] = [
  'open',
  'ask',
  'select',
  'download',
  'downloadPdf',
  'rename',
  'move',
  'copyOriginPath',
  'delete',
  'reingest',
  'cancel',
]

export const READ_ONLY_DOCUMENT_ACTIONS: readonly DocumentActionKind[] = [
  'open',
  'ask',
  'download',
  'downloadPdf',
  'copyOriginPath',
]

export interface DocumentActionLabels {
  open: string
  ask: string
  select: string
  download: string
  downloadPdf: string
  rename: string
  move: string
  copyOriginPath: string
  delete: string
  reingest: string
  reingesting: string
  cancel: string
  cancelling: string
  allFiles: string
}

export interface DocumentActionEntriesInput {
  document: ActionableDocument & { originPath?: string | null }
  labels: DocumentActionLabels
  actions?: readonly DocumentActionKind[]
  canManage?: boolean
  folders?: readonly PathFolder[]
  destinations?: readonly FolderDestination[]
  isDownloading?: boolean
  isReingesting?: boolean
  isCancelling?: boolean
  isMoving?: boolean
  onOpen?: () => void
  onAsk?: () => void
  onSelect?: () => void
  onPickMoveTarget?: () => void
  onDownload: () => void
  onDownloadPdf?: () => void
  onRename: () => void
  onDelete: () => void
  onReingest: () => void
  onCancel: () => void
  onMove: (folderId: string | null, folderName: string) => void
  onCopyOriginPath?: () => void
}

export type ReingestOffer = 'retry' | 'reread'

export function reingestOffer(
  document: Pick<ActionableDocument, 'status' | 'authoredBy'>
): ReingestOffer | null {
  const status = document.status
  if (isFailedStatus(status) || status === 'uploaded') return 'retry'
  if (isSettlingStatus(status)) return status === 'uploading' ? null : 'retry'
  if (isCitableStatus(status) && (document.authoredBy ?? 'user') === 'user') return 'reread'
  return null
}

export function cancelOffer(document: Pick<ActionableDocument, 'status'>): boolean {
  return isSettlingStatus(document.status) && document.status !== 'uploading'
}

export function documentActionEntries({
  document,
  labels,
  actions = DEFAULT_DOCUMENT_ACTIONS,
  canManage = true,
  folders,
  destinations: sortedDestinations,
  isDownloading = false,
  isReingesting = false,
  isCancelling = false,
  isMoving = false,
  onOpen,
  onAsk,
  onSelect,
  onPickMoveTarget,
  onDownload,
  onDownloadPdf,
  onRename,
  onDelete,
  onReingest,
  onCancel,
  onMove,
  onCopyOriginPath,
}: DocumentActionEntriesInput): ActionMenuEntry[] {
  const destinations = sortedDestinations ?? (folders ? sortedFolderDestinations(folders) : undefined)
  const offers = (kind: DocumentActionKind): boolean => {
    if (!actions.includes(kind)) return false
    if (kind === 'download') return true
    if (kind === 'downloadPdf') return Boolean(onDownloadPdf) && isRenditionSource(document)
    if (kind === 'open') return Boolean(onOpen)
    if (kind === 'ask') return Boolean(onAsk)
    if (kind === 'select') return canManage && Boolean(onSelect)
    if (kind === 'copyOriginPath') {
      return Boolean(document.originPath && onCopyOriginPath)
    }
    if (kind === 'reingest') return canManage && reingestOffer(document) !== null
    if (kind === 'cancel') return canManage && cancelOffer(document)
    if (kind === 'move') return canManage && Boolean(destinations && destinations.length > 0)
    return canManage
  }

  const offersReadAction = offers('reingest') || offers('cancel')

  const entries: ActionMenuEntry[] = []
  const pushSep = (): void => {
    if (entries.length > 0 && entries[entries.length - 1]?.type !== 'separator') {
      entries.push({ type: 'separator' })
    }
  }

  if (offers('open') && onOpen) {
    entries.push({
      type: 'item',
      id: 'open',
      label: labels.open,
      icon: Eye,
      onSelect: onOpen,
      testId: 'document-action-open',
    })
  }
  if (offers('ask') && onAsk) {
    entries.push({
      type: 'item',
      id: 'ask',
      label: labels.ask,
      icon: MessageSquareText,
      onSelect: onAsk,
      testId: 'document-action-ask',
    })
  }

  if (offers('select') && onSelect) {
    entries.push({
      type: 'item',
      id: 'select',
      label: labels.select,
      icon: CheckSquare,
      onSelect,
      testId: 'document-action-select',
    })
  }

  if (offersReadAction) pushSep()

  if (offers('reingest')) {
    entries.push({
      type: 'item',
      id: 'reingest',
      label: isReingesting ? labels.reingesting : labels.reingest,
      icon: RotateCcw,
      disabled: isReingesting,
      onSelect: onReingest,
      testId: 'document-action-reingest',
    })
  }

  if (offers('cancel')) {
    entries.push({
      type: 'item',
      id: 'cancel',
      label: isCancelling ? labels.cancelling : labels.cancel,
      icon: Ban,
      disabled: isCancelling,
      onSelect: onCancel,
      testId: 'document-action-cancel',
    })
  }

  if (offers('download') || offers('downloadPdf') || offers('rename') || offers('move') || offers('copyOriginPath')) {
    pushSep()
  }

  if (offers('download')) {
    entries.push({
      type: 'item',
      id: 'download',
      label: labels.download,
      icon: Download,
      disabled: isDownloading,
      onSelect: onDownload,
      testId: 'document-action-download',
    })
  }
  if (offers('downloadPdf') && onDownloadPdf) {
    entries.push({
      type: 'item',
      id: 'downloadPdf',
      label: labels.downloadPdf,
      icon: FileDown,
      disabled: isDownloading,
      onSelect: onDownloadPdf,
      testId: 'document-action-download-pdf',
    })
  }
  if (offers('rename')) {
    entries.push({
      type: 'item',
      id: 'rename',
      label: labels.rename,
      icon: Pencil,
      onSelect: onRename,
      testId: 'document-action-rename',
    })
  }
  if (offers('move') && destinations && onPickMoveTarget) {
    entries.push({
      type: 'item',
      id: 'move',
      label: labels.move,
      icon: FolderInput,
      onSelect: onPickMoveTarget,
      testId: 'document-action-move',
    })
  } else if (offers('move') && destinations) {
    const current = document.folderId ?? null
    entries.push({
      type: 'sub',
      id: 'move',
      label: labels.move,
      icon: FolderInput,
      testId: 'document-action-move',
      items: [
        {
          type: 'item',
          id: 'move-root',
          label: labels.allFiles,
          icon: current === null ? Check : Folder,
          disabled: isMoving || current === null,
          onSelect: () => onMove(null, labels.allFiles),
          testId: 'document-move-root',
        },
        ...destinations.map(({ folder, label }) => {
          const here = document.folderId === folder.id
          return {
            type: 'item' as const,
            id: `move-${folder.id}`,
            label,
            icon: here ? Check : Folder,
            disabled: isMoving || here,
            onSelect: () => onMove(folder.id, label),
          }
        }),
      ],
    })
  }
  if (offers('copyOriginPath') && onCopyOriginPath) {
    entries.push({
      type: 'item',
      id: 'copy-origin',
      label: labels.copyOriginPath,
      icon: FolderTree,
      onSelect: onCopyOriginPath,
      testId: 'document-action-copy-origin',
    })
  }

  if (offers('delete')) {
    pushSep()
    entries.push({
      type: 'item',
      id: 'delete',
      label: labels.delete,
      icon: Trash2,
      variant: 'destructive',
      onSelect: onDelete,
      testId: 'document-action-delete',
    })
  }

  return entries
}
