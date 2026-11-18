'use client'

import type { JSX } from 'react'
import { File as FileIcon } from 'lucide-react'
import { useFileThumbnail } from '@/features/knowledge/file-preview'
import { FileExtChip } from '@/features/documents'
import { cn } from '@/lib/utils'

const EDGE = 48

export function useAttachmentThumbnail(url: string | null, contentType: string, edge: number = EDGE): string | null {
  return useFileThumbnail(url, contentType, edge)
}

export function AttachmentThumbnail({
  filename,
  contentType,
  url,
  className,
}: {
  filename: string
  contentType: string
  url: string | null
  className?: string
}): JSX.Element {
  const source = useAttachmentThumbnail(url, contentType)
  return (
    <span
      data-testid="attachment-thumbnail"
      data-drawn={source ? 'true' : undefined}
      className={cn(
        'bg-background relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control pointer-coarse:size-12',
        className
      )}
    >
      {source ? (
        // oxlint-disable-next-line nextjs/no-img-element -- a data: or blob: URL drawn from bytes this tab fetched; the optimizer cannot fetch it
        <img src={source} alt="" className="size-full object-cover object-top" draggable={false} />
      ) : (
        <FileExtChip filename={filename} size="sm" className="border-0" fallback={<FileIcon className="text-muted-foreground size-4" aria-hidden />} />
      )}
    </span>
  )
}
