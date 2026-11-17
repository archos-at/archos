'use client'

import type { JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { FileExtChip } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { useAttachmentThumbnail } from './attachment-thumbnail'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const PREVIEW_EDGE = 640

export function AttachmentPreviewDialog({
  open,
  onOpenChange,
  name,
  contentType,
  url,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  contentType: string
  url: string | null
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const source = useAttachmentThumbnail(open ? url : null, contentType, PREVIEW_EDGE)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" instant closeLabel={t('target.cancel')} data-testid="attachment-preview">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{name}</DialogTitle>
          <DialogDescription className="sr-only">{t('attachments.preview', { name })}</DialogDescription>
        </DialogHeader>
        <div className="bg-desk flex min-h-64 items-center justify-center overflow-hidden rounded-surface" /* the desk behind a document */>
          {source ? (
            // oxlint-disable-next-line nextjs/no-img-element -- a data: or blob: URL drawn from bytes this tab fetched; the optimizer cannot fetch it
            <img src={source} alt="" className="max-h-[70dvh] w-auto max-w-full object-contain" />
          ) : url ? (
            <Skeleton className="h-64 w-48" />
          ) : (
            <FileExtChip filename={name} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
