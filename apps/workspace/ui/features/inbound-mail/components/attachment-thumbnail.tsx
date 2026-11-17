'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { File as FileIcon } from 'lucide-react'
import { documentParameters, loadPdfjs } from '@/features/knowledge'
import { FileExtChip } from '@/features/documents'
import { cn } from '@/lib/utils'

const EDGE = 48

async function pdfFirstPage(bytes: ArrayBuffer, signal: AbortSignal, edge: number): Promise<string | null> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ ...documentParameters(''), url: undefined, data: new Uint8Array(bytes) })
  signal.addEventListener('abort', () => void task.destroy(), { once: true })
  const document = await task.promise
  try {
    const page = await document.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = (edge * 2) / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    return canvas.toDataURL('image/png')
  } finally {
    void task.destroy()
  }
}

export function useAttachmentThumbnail(url: string | null, contentType: string, edge: number = EDGE): string | null {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return
        if (contentType.toLowerCase() === 'application/pdf') {
          const image = await pdfFirstPage(await response.arrayBuffer(), controller.signal, edge)
          if (!controller.signal.aborted) setSource(image)
          return
        }
        objectUrl = URL.createObjectURL(await response.blob())
        if (!controller.signal.aborted) setSource(objectUrl)
      } catch {
        // No thumbnail: the tile stands in.
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setSource(null)
    }
  }, [url, contentType, edge])
  return source
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
