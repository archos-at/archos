'use client'

import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { DeleteDocumentDialog } from './delete-document-dialog'
import { RenameDocumentDialog } from './rename-document-dialog'
import {
  documentActionEntries,
  reingestOffer,
  type DocumentActionKind,
} from './action-entries'
import { useDocumentActions, type ActionableDocument } from './use-document-actions'
import { DOCUMENT_SCOPE_COPY, type DocumentScope } from './document-scope'
import { sortedFolderDestinations, type FolderDestination, type PathFolder } from '../../lib/folder-path-label'
import { FolderPickerSheet } from '../folder-picker-sheet'

export type { DocumentActionKind }

const NO_ENTRIES: readonly ActionMenuEntry[] = []

const DEFAULT_ACTIONS: readonly DocumentActionKind[] = [
  'download',
  'downloadPdf',
  'rename',
  'move',
  'delete',
  'reingest',
]

export type MoveTargetFolder = PathFolder

const SHEET_MOVE_QUERY = '(pointer: coarse), (max-width: 639px)'

export function useMoveInSheet(): boolean {
  return useMediaQuery(SHEET_MOVE_QUERY)
}

export interface DocumentActionsMenuProps {
  document: ActionableDocument & { originPath?: string | null }
  scope: DocumentScope
  actions?: readonly DocumentActionKind[]
  canManage?: boolean
  onRenamed?: (documentId: string, displayName: string | null) => void
  onDeleted?: (documentId: string) => void
  onReingested?: (documentId: string, status: string) => void
  onCancelled?: (documentId: string, status: string) => void
  folders?: readonly MoveTargetFolder[]
  destinations?: readonly FolderDestination[]
  onMoved?: (documentId: string, folderId: string | null) => void
  onOpen?: () => void
  onAsk?: () => void
  onSelectMode?: () => void
  extraEntries?: readonly ActionMenuEntry[]
  moveInSheet?: boolean
  trigger?: ReactNode
  surface?: 'floating' | 'toolbar'
  align?: 'start' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function useDocumentActionMenu({
  document,
  scope,
  actions = DEFAULT_ACTIONS,
  canManage = true,
  onRenamed,
  onDeleted,
  onReingested,
  onCancelled,
  folders,
  destinations,
  onMoved,
  onOpen,
  onAsk,
  onSelectMode,
  extraEntries = NO_ENTRIES,
  moveInSheet = false,
  live = true,
}: Omit<DocumentActionsMenuProps, 'trigger' | 'align' | 'side'> & {
  live?: boolean
}) {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[scope])
  const filesT = useTranslations(filesCopy)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rereadOpen, setRereadOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const documentActions = useDocumentActions({
    document,
    scope,
    onRenamed,
    onDeleted,
    onReingested,
    onCancelled,
    onMoved,
  })

  if (!live) return { entries: NO_ENTRIES, dialogs: null, name: documentActions.name }

  const copyOriginPath = (): void => {
    const path = document.originPath
    if (!path) return
    void navigator.clipboard
      ?.writeText(path)
      .then(() => toast.success(filesT('preview.originPathCopied')))
      .catch(() => toast.error(filesT('preview.originPathCopyFailed')))
  }

  const ownEntries = documentActionEntries({
    document,
    labels: {
      open: t('actions.open'),
      ask: t('actions.ask'),
      select: t('actions.select'),
      download: t('actions.download'),
      downloadPdf: t('actions.downloadPdf'),
      rename: t('actions.rename'),
      move: t('actions.move'),
      copyOriginPath: t('actions.copyOriginPath'),
      delete: t('actions.delete'),
      reingest: t('actions.reingest'),
      reingesting: t('actions.reingesting'),
      cancel: t('actions.cancel'),
      cancelling: t('actions.cancelling'),
      allFiles: filesT('folders.allFiles'),
    },
    actions,
    canManage,
    folders,
    destinations,
    isDownloading: documentActions.isDownloading,
    isReingesting: documentActions.isReingesting,
    isCancelling: documentActions.isCancelling,
    isMoving: documentActions.isMoving,
    onOpen,
    onAsk,
    onSelect: onSelectMode,
    onPickMoveTarget: moveInSheet ? () => setMoveOpen(true) : undefined,
    onDownload: () => void documentActions.download(),
    onDownloadPdf: () => void documentActions.downloadPdf(),
    onRename: () => setRenameOpen(true),
    onDelete: () => setDeleteOpen(true),
    onReingest: () =>
      reingestOffer(document) === 'reread'
        ? setRereadOpen(true)
        : void documentActions.reingest(),
    onCancel: () => void documentActions.cancel(),
    onMove: (folderId, folderName) => void documentActions.move(folderId, folderName),
    onCopyOriginPath: document.originPath ? copyOriginPath : undefined,
  })
  const entries: readonly ActionMenuEntry[] =
    extraEntries.length > 0 && ownEntries.length > 0 ? [...ownEntries, { type: 'separator' }, ...extraEntries] : [...ownEntries, ...extraEntries]

  const dialogs = (
    <>
      {moveInSheet && entries.some((entry) => entry.type === 'item' && entry.id === 'move') && (
        <FolderPickerSheet
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={filesT('picker.titleOne', { name: documentActions.name })}
          destinations={destinations ?? sortedFolderDestinations(folders ?? [])}
          currentFolderId={document.folderId ?? null}
          pending={documentActions.isMoving}
          onPick={(folderId, folderName) => {
            setMoveOpen(false)
            void documentActions.move(folderId, folderName)
          }}
        />
      )}
      {entries.some((entry) => entry.type === 'item' && entry.id === 'rename') && (
        <RenameDocumentDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          document={document}
          scope={scope}
          onRename={documentActions.rename}
          pending={documentActions.isRenaming}
        />
      )}
      {entries.some((entry) => entry.type === 'item' && entry.id === 'delete') && (
        <DeleteDocumentDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          scope={scope}
          actions={documentActions}
        />
      )}
      {entries.some((entry) => entry.type === 'item' && entry.id === 'reingest') && (
        <ConfirmDialog
          open={rereadOpen}
          onOpenChange={setRereadOpen}
          title={t('actions.reingestConfirmTitle', { name: documentActions.name })}
          description={t('actions.reingestConfirmDescription')}
          confirmLabel={
            documentActions.isReingesting ? t('actions.reingesting') : t('actions.reingestConfirmAction')
          }
          cancelLabel={t('delete.cancel')}
          pending={documentActions.isReingesting}
          tone="default"
          confirmTestId="document-reingest-confirm"
          onConfirm={async () => {
            await documentActions.reingest()
            setRereadOpen(false)
          }}
        />
      )}
    </>
  )

  return { entries, dialogs, name: documentActions.name }
}

export function DocumentActionsMenu({
  trigger,
  surface = 'floating',
  align = 'end',
  side = 'bottom',
  ...props
}: DocumentActionsMenuProps): ReactNode {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[props.scope])
  const { entries, dialogs, name } = useDocumentActionMenu(props)
  if (entries.length === 0) return null
  return (
    <>
      <ActionMenu
        mode="dropdown"
        entries={entries}
        align={align}
        side={side}
        trigger={
          trigger ?? (
            <Button
              type="button"
              variant={surface === 'toolbar' ? 'secondary' : 'ghost'}
              size="icon"
              className={cn(
                'size-8 shrink-0',
                surface === 'floating' && 'bg-background/85 rounded-full backdrop-blur-sm',
              )}
              aria-label={t('actions.label', { name })}
              title={t('actions.menuLabel')}
              data-testid="document-actions-trigger"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          )
        }
      />
      {dialogs}
    </>
  )
}
