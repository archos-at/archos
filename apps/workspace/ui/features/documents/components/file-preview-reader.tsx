'use client'

import type { JSX } from 'react'

import { useState, useEffect, type ReactNode } from 'react'

import { toast } from 'sonner'
import type { FileItem } from './project-file-workspace'
import { ListTree, MessageSquarePlus, MessageSquareText, ShieldOff, Trash2, X } from 'lucide-react'

import { ApiRequestError } from '@/adapters/api/api-error'
import { getQuarantineReviewAccess, releaseQuarantinedDocument, type QuarantineReviewAccess } from '@/adapters/api/upload-screening-client'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'

import { RequestReviewButton } from './request-review-button'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { filesCopy } from '@/i18n/namespaces/files'
import { organizationCopy } from '@/i18n/namespaces/organization'

import { cn } from '@/lib/utils'

import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DeleteDocumentDialog, type DocumentActions, type DocumentScope } from './document-actions'

import { AssignPopover } from './assign-popover'
import { useRouter } from 'next/navigation'

import { askAboutFile } from '../lib/ask-about-file'

import { CountPill } from '@/components/ui/count-pill'

export function HeldReview({
  documentId,
  scope,
  actions,
  onReleased,
}: {
  documentId: string
  scope: DocumentScope
  actions: DocumentActions
  onReleased: (status: string) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const tOrg = useTranslations(organizationCopy)
  const tc = useTranslations(commonCopy)
  const [access, setAccess] = useState<QuarantineReviewAccess | null>(null)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getQuarantineReviewAccess(documentId, controller.signal)
      .then(setAccess)
      .catch(() => {
        if (!controller.signal.aborted) setAccess({ canReview: false, canAskForReview: false })
      })
    return () => controller.abort()
  }, [documentId])

  const release = async (): Promise<void> => {
    try {
      const { status } = await releaseQuarantinedDocument(documentId)
      notifyDocumentsChanged()
      toast.success(tOrg('quarantine.released', { name: actions.name }))
      onReleased(status)
    } catch (error) {
      const decided = error instanceof ApiRequestError && (error.status === 409 || error.status === 404)
      if (decided) notifyDocumentsChanged()
      toast.error(decided ? t('preview.heldDecided') : tOrg('quarantine.releaseError'))
    }
  }

  if (access?.canAskForReview) {
    return <RequestReviewButton documentId={documentId} name={actions.name} testId="preview-held-request-review" />
  }
  if (!access?.canReview) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-testid="preview-held-review">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setReleaseOpen(true)}
          data-testid="preview-held-release"
        >
          {tOrg('quarantine.release')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          disabled={actions.isDeleting}
          data-testid="preview-held-delete"
        >
          <Trash2 className="size-4" aria-hidden />
          {tOrg('quarantine.delete')}
        </Button>
      </div>
      <ConfirmDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title={tOrg('quarantine.releaseTitle', { name: actions.name })}
        description={tOrg('quarantine.releaseDescription')}
        confirmLabel={tOrg('quarantine.release')}
        cancelLabel={tc('actions.cancel')}
        tone="warning"
        icon={ShieldOff}
        confirmTestId="preview-held-release-confirm"
        onConfirm={release}
      />
      <DeleteDocumentDialog open={deleteOpen} onOpenChange={setDeleteOpen} scope={scope} actions={actions} />
    </>
  )
}

export function AskColleagueButton({
  projectId,
  file,
  documentId,
}: {
  projectId: string
  file: FileItem
  documentId: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const router = useRouter()
  return (
    <AssignPopover
      documentId={documentId}
      assignees={file.assignees ?? []}
      pickOnly
      onPick={(person) => {
        const name = person.name || person.email || t('assignment.to')
        askAboutFile({
          projectId,
          file,
          ask: `@${name} `,
          mentions: [{ targetId: person.userId, display: name }],
          navigate: (href) => router.push(href),
        })
      }}
      onChanged={() => undefined}
      trigger={
        <Button type="button" variant="secondary" size="sm" className="h-8 w-full">
          {t('assignment.askColleague')}
        </Button>
      }
    />
  )
}

export function ReaderHeader({
  name,
  title,
  facts,
  contentType,
  status,
  actions,
  closeLabel,
  onClose,
}: {
  name: string
  title: string
  facts: string | null
  contentType: string | null | undefined
  status: ReactNode
  actions: ReactNode
  closeLabel: string
  onClose?: () => void
}): JSX.Element {
  return (
    <div
      data-testid="file-reader-header"
      className="bg-card flex shrink-0 items-center gap-2 pt-[max(0.375rem,env(safe-area-inset-top))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-1.5 pl-[max(1rem,env(safe-area-inset-left))]"
    >
      <div className="min-w-0 flex-1 py-1">
        {/* The section step (16/24/600), as the dialog's own title: one title for one file, at every width. */}
        <h3 className="text-foreground flex text-section" title={title}>
          <MiddleTruncate text={name} />
        </h3>
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {facts && (
            <span
              className="text-muted-foreground min-w-0 shrink truncate text-xs tabular-nums"
              title={contentType ?? undefined}
              data-testid="file-preview-facts"
            >
              {facts}
            </span>
          )}
          {status}
        </div>
      </div>
      {actions}
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          onClick={onClose}
          aria-label={closeLabel}
          data-testid="file-reader-close"
        >
          <X className="size-5" aria-hidden />
        </Button>
      )}
    </div>
  )
}

export interface ReaderAnnotate {
  label: string
  count: number
  countLabel: string
  onClick: () => void
}

export function ReaderActions({
  layout,
  detailsLabel,
  detailsOpen,
  onDetails,
  annotate,
  discuss,
  menu,
}: {
  layout: 'bar' | 'header'
  detailsLabel: string
  detailsOpen: boolean
  onDetails: () => void
  annotate: ReaderAnnotate | null
  discuss: ReactNode
  menu: ReactNode
}): JSX.Element {
  const bar = layout === 'bar'
  return (
    <div
      data-testid={bar ? 'file-reader-bar' : 'file-reader-actions'}
      className={cn(
        'flex items-center',
        bar
          ? 'bg-card shrink-0 gap-3 pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]'
          : 'shrink-0 gap-1',
      )}
    >
      <Button
        type="button"
        variant="secondary"
        size={bar ? 'default' : 'sm'}
        className={cn(
          'gap-1.5',
          bar ? 'h-11' : 'h-9 pointer-coarse:h-11',
          bar && annotate && 'max-[27.5rem]:w-11 max-[27.5rem]:px-0',
          bar && !discuss && 'flex-1'
        )}
        aria-expanded={detailsOpen}
        aria-haspopup="dialog"
        onClick={onDetails}
        data-testid="file-reader-details"
      >
        <ListTree className="size-4" aria-hidden />
        {/* „Besprechen“ and the menu with a word beside them do not fit a 393px bar: the presses beside it keep
            their glyphs and give their names to a screen reader, so the primary keeps its padding. */}
        <span className={cn(bar && 'max-[27.5rem]:sr-only')}>{detailsLabel}</span>
      </Button>
      {annotate && (
        <Button
          type="button"
          variant="secondary"
          size={bar ? 'default' : 'sm'}
          className={cn('gap-1.5', bar ? 'h-11 min-w-11 shrink-0 px-3' : 'h-9 pointer-coarse:h-11')}
          aria-label={annotate.count > 0 ? annotate.countLabel : annotate.label}
          onClick={annotate.onClick}
          data-testid="file-reader-annotate"
        >
          {annotate.count > 0 ? <MessageSquareText className="size-4" aria-hidden /> : <MessageSquarePlus className="size-4" aria-hidden />}
          <span className={cn('truncate', bar && 'max-[27.5rem]:sr-only')}>{annotate.label}</span>
          {annotate.count > 0 && <CountPill aria-hidden count={annotate.count} />}
        </Button>
      )}
      {discuss}
      <span className="[&_[data-testid=document-actions-trigger]]:size-11 contents">{menu}</span>
    </div>
  )
}

export function ReaderDetails({
  sheet,
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  sheet: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
}): JSX.Element {
  if (!sheet) return <>{children}</>
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="file-reader-details-sheet"
        className="bg-card max-h-[85dvh] gap-0 overflow-y-auto overscroll-contain rounded-t-2xl p-0"
      >
        <SheetHeader className="bg-card sticky top-0 z-[1] px-4 pt-4 pb-2">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}
