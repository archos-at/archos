import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { documentParameters, loadPdfjs } from '../lib/pdfjs-runtime'
import type { PassageIndex } from '../lib/passage-highlight'
import type { PdfDocumentViewProps } from '../components/pdf-document-view-props'
import { passwordState, type LoadState, type PassageHit } from '../components/pdf-document-view-helpers'

export interface PdfDocumentLoadArgs extends Pick<PdfDocumentViewProps, 'src' | 'page' | 'highlight' | 'onLoadError'> {
  password: string | null
  attempt: number
  doc: PDFDocumentProxy | null
  setDoc: Dispatch<SetStateAction<PDFDocumentProxy | null>>
  loadState: LoadState
  setLoadState: Dispatch<SetStateAction<LoadState>>
  pageIndexes: RefObject<Map<number, PassageIndex>>
  foundRef: RefObject<boolean>
  scrollRef: RefObject<HTMLDivElement | null>
  setHit: Dispatch<SetStateAction<PassageHit | null>>
  setMissed: Dispatch<SetStateAction<number[]>>
  setDefaultAspect: Dispatch<SetStateAction<number | null>>
  setFirstPageWidth: Dispatch<SetStateAction<number | null>>
  setFrame: Dispatch<SetStateAction<{ width: number; height: number }>>
}

export function usePdfDocumentLoad({
  src,
  page,
  highlight,
  onLoadError,
  password,
  attempt,
  doc,
  setDoc,
  loadState,
  setLoadState,
  pageIndexes,
  foundRef,
  scrollRef,
  setHit,
  setMissed,
  setDefaultAspect,
  setFirstPageWidth,
  setFrame,
}: PdfDocumentLoadArgs) {
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setLoadState('loading')
    const parameters = password ? { ...documentParameters(src), password } : documentParameters(src)
    const task = loadPdfjs().then((pdfjs) => pdfjs.getDocument(parameters))
    task
      .then((loading) => loading.promise)
      .then((loaded) => {
        if (cancelled) return
        setDoc(loaded)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadState(passwordState(error) ?? 'failed')
      })
    return () => {
      cancelled = true
      void task.then((loading) => loading.destroy()).catch(() => {})
    }
  }, [src, password, attempt])

  useEffect(() => {
    pageIndexes.current = new Map()
  }, [doc])

  useEffect(() => {
    if (loadState === 'failed') onLoadError?.()
  }, [loadState, onLoadError])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    doc
      .getPage(1)
      .then((first) => {
        if (cancelled) return
        const base = first.getViewport({ scale: 1 })
        setDefaultAspect(base.height / base.width)
        setFirstPageWidth(base.width)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    foundRef.current = false
    setHit(null)
    setMissed([])
  }, [page, highlight])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect?.width) setFrame({ width: rect.width, height: rect.height || 0 })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [doc])
}
