'use client'

import { useEffect, useState } from 'react'
import { documentParameters, loadPdfjs } from '../lib/pdfjs-runtime'

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

export type FileThumbnailState = 'idle' | 'loading' | 'drawn' | 'failed'

export function useFileThumbnailState(
  url: string | null,
  contentType: string,
  edge: number,
): { source: string | null; state: FileThumbnailState } {
  const [source, setSource] = useState<string | null>(null)
  const [state, setState] = useState<FileThumbnailState>('idle')
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    setState('loading')
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`thumbnail answered ${response.status}`)
        if (contentType.toLowerCase() === 'application/pdf') {
          const image = await pdfFirstPage(await response.arrayBuffer(), controller.signal, edge)
          if (controller.signal.aborted) return
          setSource(image)
        } else {
          objectUrl = URL.createObjectURL(await response.blob())
          if (controller.signal.aborted) return
          setSource(objectUrl)
        }
        setState('drawn')
      } catch {
        if (!controller.signal.aborted) setState('failed')
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setSource(null)
      setState('idle')
    }
  }, [url, contentType, edge])
  return { source, state }
}

export function useFileThumbnail(url: string | null, contentType: string, edge: number): string | null {
  return useFileThumbnailState(url, contentType, edge).source
}
