'use client'

import { useEffect, useState, type FC, type MouseEvent } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { GENERATED_DOCUMENT_FOLDER_NAME } from '@/lib/documents/generated-folder'
import { documentFilesHref, openFiledDocument } from '@/features/documents/chat-card-parts'
import { SaveToProjectDialog } from '@/features/documents/save-to-project'
import { draftFileType, filedExtension } from '@/lib/conversations/draft-media'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { DraftFiling } from '../hooks/use-draft-filing'
import type { DraftLifeState } from '../hooks/use-draft-life'

export const DRAFT_ACTION = cn(
  'inline-flex min-h-11 items-center rounded-control font-medium text-primary',
  'transition-colors duration-quick ease-out motion-reduce:transition-none',
  'hover:text-primary/80 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
  'aria-disabled:cursor-default aria-disabled:opacity-60',
)

interface FiledTarget {
  documentId: string
  projectId: string
  href: string
  isMobile: boolean
}

export function openFiled(target: FiledTarget): void {
  if (target.isMobile) {
    window.location.assign(target.href)
    return
  }
  void openFiledDocument({ documentId: target.documentId, projectId: target.projectId }).then((opened) => {
    if (!opened) window.location.assign(target.href)
  })
}

export function openFiledInPlace(event: MouseEvent<HTMLAnchorElement>, target: FiledTarget): void {
  if (target.isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  openFiled(target)
}

export const DraftConflictNotice: FC<{ filing: DraftFiling }> = ({ filing }) => {
  const t = useTranslations(chatCopy)
  const { conflict, projectId, isFiling } = filing
  if (!conflict || filing.shownFiled) return null
  return (
    <div className="flex flex-col gap-1" data-testid="document-draft-conflict">
      <p className="card-caption text-muted-foreground">{t('cards.documentDraft.fileConflict')}</p>
      <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
        {projectId && (
          <a
            href={documentFilesHref(projectId, conflict.documentId)}
            className={DRAFT_ACTION}
            data-testid="document-draft-conflict-open"
          >
            {conflict.displayName}
          </a>
        )}
        <button
          type="button"
          className={DRAFT_ACTION}
          aria-disabled={isFiling || undefined}
          aria-busy={isFiling || undefined}
          onClick={() => void filing.file(true)}
        >
          <StackedLabel
            busy={isFiling}
            idle={t('cards.documentDraft.fileAnyway')}
            working={t('cards.documentDraft.filing')}
          />
        </button>
      </p>
    </div>
  )
}

export interface DraftSource {
  documentId: string
  name: string
}

interface SourceFolder {
  folderId: string | null | undefined
  loading: boolean
}

function useSourceFolder(source: DraftSource | null | undefined): SourceFolder {
  const documentId = source?.documentId
  const [found, setFound] = useState<{ documentId: string; folderId: string | null | undefined } | null>(null)
  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    const settle = (folderId: string | null | undefined) => {
      if (!cancelled) setFound({ documentId, folderId })
    }
    void fetch(`/api/documents/${encodeURIComponent(documentId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const document = (body as { document?: { folderId?: string | null } } | null)?.document
        settle(document && document.folderId !== undefined ? document.folderId : undefined)
      })
      .catch(() => settle(undefined))
    return () => {
      cancelled = true
    }
  }, [documentId])
  if (!documentId) return { folderId: undefined, loading: false }
  const settled = found?.documentId === documentId
  return { folderId: settled ? found.folderId : undefined, loading: !settled }
}

export const DraftSaveDialog: FC<{
  filing: DraftFiling
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  path: string
  source?: DraftSource | null
  asOwn?: boolean
}> = ({ filing, open, onOpenChange, title, path, source, asOwn = false }) => {
  const sourceFolder = useSourceFolder(source)
  if (!filing.projectId) return null
  return (
    <SaveToProjectDialog
      open={open}
      onOpenChange={onOpenChange}
      projectId={filing.projectId}
      fileName={title}
      extension={filedExtension(draftFileType(path))}
      initialFolderId={sourceFolder.folderId ?? null}
      initialFolderName={source ? undefined : GENERATED_DOCUMENT_FOLDER_NAME}
      locating={sourceFolder.loading}
      revisionOf={source?.name}
      pending={filing.isFiling}
      error={open ? filing.error : null}
      onSave={async ({ folderId, name, as, changeNote }) => {
        const outcome = await filing.file(
          false,
          as === 'revision' ? { as, changeNote } : { folderId, name, ...(as || asOwn ? { as: 'own' as const } : {}) },
        )
        if (outcome !== 'failed') onOpenChange(false)
      }}
    />
  )
}

export const ProjectChangeNotice: FC<{ filing: DraftFiling; name: string; onFileAsOwn: () => void }> = ({
  filing,
  name,
  onFileAsOwn,
}) => {
  const t = useTranslations(chatCopy)
  const { projectChange, isFiling } = filing
  if (!projectChange) return null
  return (
    <div className="flex flex-col gap-1" role="alert" data-testid="draft-project-change">
      <p className="card-caption text-foreground">
        {projectChange.versionNumber === null
          ? t('cards.fileDraft.changedInProject', { name })
          : t('cards.fileDraft.changedInProjectNumbered', { name, number: String(projectChange.versionNumber) })}
      </p>
      <p className="card-caption flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          className={DRAFT_ACTION}
          aria-disabled={isFiling || undefined}
          aria-busy={isFiling || undefined}
          onClick={() => void filing.fileOverChanges()}
          data-testid="draft-over-changes"
        >
          <StackedLabel busy={isFiling} idle={t('cards.fileDraft.overChanges')} working={t('cards.documentDraft.filing')} />
        </button>
        <button
          type="button"
          className={DRAFT_ACTION}
          aria-disabled={isFiling || undefined}
          onClick={onFileAsOwn}
          data-testid="draft-as-own-file"
        >
          {t('cards.fileDraft.asOwnFile')}
        </button>
      </p>
    </div>
  )
}

export const DraftMenu: FC<{
  life: DraftLifeState
  name: string
  filed: boolean
  onRemoved: () => void
  className?: string
}> = ({ life, name, filed, onRemoved, className }) => {
  const t = useTranslations(chatCopy)
  const [confirming, setConfirming] = useState(false)
  if (life.removed) return null
  const entries: ActionMenuEntry[] = [
    {
      type: 'item',
      id: 'delete',
      label: t('cards.fileDraft.delete'),
      icon: Trash2,
      variant: 'destructive',
      disabled: life.deleting,
      onSelect: () => setConfirming(true),
      testId: 'draft-delete',
    },
  ]
  return (
    <>
      <ActionMenu
        mode="dropdown"
        align="end"
        entries={entries}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-8', className)}
            aria-label={t('cards.fileDraft.menu', { name })}
            data-testid="draft-menu"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('cards.fileDraft.deleteTitle', { name })}
        description={`${t('cards.fileDraft.deleteDescription')}${filed ? ` ${t('cards.fileDraft.deleteKeepsFiled')}` : ''}`}
        confirmLabel={t('cards.fileDraft.delete')}
        cancelLabel={t('cards.fileDraft.deleteCancel')}
        tone="destructive"
        pending={life.deleting}
        confirmTestId="draft-delete-confirm"
        onConfirm={async () => {
          if (!(await life.remove())) return
          setConfirming(false)
          onRemoved()
        }}
      >
        {life.deleteFailed && (
          <p className="text-destructive text-sm" role="alert" data-testid="draft-delete-error">
            {t('cards.fileDraft.deleteError')}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
