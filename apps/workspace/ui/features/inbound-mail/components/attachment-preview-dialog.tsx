'use client'

import type { JSX, RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InsetStage } from '@/components/ui/inset-stage'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Skeleton } from '@/components/ui/skeleton'
import { FileExtChip } from '@/features/documents'
import { PdfDocumentView } from '@/features/knowledge/file-preview'
import { useTranslations } from '@/i18n'
import { useAttachmentThumbnail } from './attachment-thumbnail'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface PreviewItem {
  id: string
  name: string
  contentType: string
  url: string | null
}

const isPdf = (contentType: string): boolean => contentType.toLowerCase() === 'application/pdf'

/** A PDF in the app's own viewer (pdf.js draws it, nothing in it runs), a picture whole; ← → step through them. */
export function AttachmentPreviewDialog({
  open,
  onOpenChange,
  items,
  currentId,
  onCurrentChange,
  returnFocusRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly PreviewItem[]
  currentId: string | null
  onCurrentChange: (id: string) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const index = Math.max(0, items.findIndex((item) => item.id === currentId))
  const item = items[index] as PreviewItem | undefined
  const step = (by: number): void => {
    const next = items[index + by]
    if (next) onCurrentChange(next.id)
  }
  return (
    <Dialog open={open && !!item} onOpenChange={onOpenChange}>
      <DialogContent
        mobilePresentation="fullscreen"
        instant
        closeLabel={t('preview.close')}
        data-testid="attachment-preview"
        data-preview-id={item?.id}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
        onKeyDown={(event) => {
          if (items.length < 2 || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
          const target = event.target as HTMLElement
          if (target.closest('input, textarea, [contenteditable="true"]')) return
          if (event.key === 'ArrowRight') step(1)
          else if (event.key === 'ArrowLeft') step(-1)
          else return
          event.preventDefault()
        }}
        className="flex h-[90dvh] w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] max-w-5xl flex-col gap-3 p-4 sm:max-w-5xl sm:p-5 phone:h-dvh phone:max-h-dvh phone:w-screen phone:max-w-none phone:gap-0 phone:p-0"
      >
        <DialogHeader className="shrink-0 pr-10 text-left phone:gap-1 phone:pt-[max(0.75rem,env(safe-area-inset-top))] phone:pr-[calc(env(safe-area-inset-right)+3.75rem)] phone:pb-2 phone:pl-[max(1rem,env(safe-area-inset-left))]">
          <DialogTitle className="flex min-w-0 text-base">
            <MiddleTruncate text={item?.name ?? ''} />
          </DialogTitle>
          <DialogDescription className="text-xs">
            {items.length > 1 ? t('preview.position', { position: index + 1, count: items.length }) : t('preview.description')}
          </DialogDescription>
          {items.length > 1 && (
            <div className="flex items-center gap-2 pt-1" data-testid="attachment-preview-steps">
              <Button type="button" size="sm" variant="secondary" onClick={() => step(-1)} disabled={index === 0} data-testid="attachment-preview-previous">
                <ChevronLeft aria-hidden />
                {t('preview.previous')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => step(1)} disabled={index === items.length - 1} data-testid="attachment-preview-next">
                {t('preview.next')}
                <ChevronRight aria-hidden />
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col phone:pb-[env(safe-area-inset-bottom)]">
          {open && item && <PreviewBody key={item.id} item={item} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ item }: { item: PreviewItem }): JSX.Element {
  if (item.url && isPdf(item.contentType)) return <PdfDocumentView src={item.url} title={item.name} bleed />
  return <PictureBody item={item} />
}

function PictureBody({ item }: { item: PreviewItem }): JSX.Element {
  const source = useAttachmentThumbnail(item.url, item.contentType, 0)
  return (
    <InsetStage className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto overscroll-contain p-3">
      {source ? (
        // oxlint-disable-next-line nextjs/no-img-element -- a blob: URL drawn from bytes this tab fetched; the optimizer cannot fetch it
        <img src={source} alt="" className="h-auto max-h-full w-auto max-w-full object-contain" />
      ) : item.url ? (
        <Skeleton className="h-64 w-48" />
      ) : (
        <FileExtChip filename={item.name} />
      )}
    </InsetStage>
  )
}
