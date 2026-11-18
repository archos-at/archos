'use client'

import { useEffect, useState, type FC, type MouseEvent } from 'react'
import { MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
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

function useSourceFolder(source: DraftSource | null | undefined, open: boolean): string | null | undefined {
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined)
  const documentId = source?.documentId
  useEffect(() => {
    if (!open || !documentId) return
    let cancelled = false
    void fetch(`/api/documents/${encodeURIComponent(documentId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled) return
        const document = (body as { document?: { folderId?: string | null } } | null)?.document
        setFolderId(document && document.folderId !== undefined ? document.folderId : undefined)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, documentId])
  return documentId ? folderId : undefined
}

export const DraftSaveDialog: FC<{
  filing: DraftFiling
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  path: string
  source?: DraftSource | null
}> = ({ filing, open, onOpenChange, title, path, source }) => {
  const sourceFolder = useSourceFolder(source, open)
  if (!filing.projectId) return null
  return (
    <SaveToProjectDialog
      open={open}
      onOpenChange={onOpenChange}
      projectId={filing.projectId}
      fileName={title}
      extension={filedExtension(draftFileType(path))}
      initialFolderId={sourceFolder ?? null}
      initialFolderName={source ? undefined : GENERATED_DOCUMENT_FOLDER_NAME}
      revisionOf={source?.name}
      pending={filing.isFiling}
      error={open ? filing.error : null}
      onSave={async ({ folderId, name, as, changeNote }) => {
        const outcome = await filing.file(
          false,
          as === 'revision' ? { as, changeNote } : { folderId, name, ...(as ? { as } : {}) },
        )
        if (outcome !== 'failed') onOpenChange(false)
      }}
    />
  )
}

export const ProjectChangeNotice: FC<{ filing: DraftFiling; name: string }> = ({ filing, name }) => {
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
          onClick={() => void filing.fileOverChanges()}
          data-testid="draft-over-changes"
        >
          {t('cards.fileDraft.overChanges')}
        </button>
        <button
          type="button"
          className={DRAFT_ACTION}
          aria-disabled={isFiling || undefined}
          onClick={() => void filing.fileAsOwn()}
          data-testid="draft-as-own-file"
        >
          {t('cards.fileDraft.asOwnFile')}
        </button>
      </p>
    </div>
  )
}

export const DraftMenu: FC<{ life: DraftLifeState; name: string }> = ({ life, name }) => {
  const t = useTranslations(chatCopy)
  const [confirming, setConfirming] = useState(false)
  if (life.removed) return null
  const entries: ActionMenuEntry[] = [
    ...(life.canRestore
      ? [
          {
            type: 'item' as const,
            id: 'restore',
            label: t('cards.fileDraft.restorePrevious'),
            icon: RotateCcw,
            disabled: life.busy !== null,
            onSelect: () => void life.restore(),
            testId: 'draft-restore',
          },
        ]
      : []),
    {
      type: 'item',
      id: 'delete',
      label: t('cards.fileDraft.delete'),
      icon: Trash2,
      variant: 'destructive',
      disabled: life.busy !== null,
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
            className="-mr-2 -mt-2 shrink-0"
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
        description={t('cards.fileDraft.deleteDescription')}
        confirmLabel={t('cards.fileDraft.delete')}
        cancelLabel={t('cards.fileDraft.deleteCancel')}
        tone="destructive"
        pending={life.busy === 'delete'}
        confirmTestId="draft-delete-confirm"
        onConfirm={async () => {
          if (await life.remove()) setConfirming(false)
        }}
      />
    </>
  )
}

export const DraftLifeNote: FC<{ life: DraftLifeState }> = ({ life }) => {
  const t = useTranslations(chatCopy)
  if (life.failed === null) return null
  return (
    <p className="card-caption text-destructive" role="alert" data-testid="draft-life-error">
      {life.failed === 'restore' ? t('cards.fileDraft.restoreError') : t('cards.fileDraft.deleteError')}
    </p>
  )
}
