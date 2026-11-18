import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import type { PdfDocumentViewProps } from '../components/pdf-document-view-props'
import { COPIED_FEEDBACK_MS, MIN_QUOTE_LENGTH, type QuoteSelection } from '../components/pdf-document-view-helpers'

export interface PdfQuoteSelectionArgs {
  quoteFormat: PdfDocumentViewProps['quoteFormat']
  onFindSimilar: PdfDocumentViewProps['onFindSimilar']
  doc: PDFDocumentProxy | null
  targetWidth: number
  quote: QuoteSelection | null
  setQuote: Dispatch<SetStateAction<QuoteSelection | null>>
  copied: 'idle' | 'done' | 'failed'
  setCopied: Dispatch<SetStateAction<'idle' | 'done' | 'failed'>>
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  quotedRef: RefObject<string | null>
  currentPageRef: RefObject<number>
}

export function usePdfQuoteSelection({
  quoteFormat,
  onFindSimilar,
  doc,
  targetWidth,
  quote,
  setQuote,
  copied,
  setCopied,
  scrollRef,
  contentRef,
  quotedRef,
  currentPageRef,
}: PdfQuoteSelectionArgs) {
  const readSelection = useCallback((): void => {
    const frameNode = scrollRef.current
    const content = contentRef.current
    if (!(quoteFormat || onFindSimilar) || !frameNode || !content) return

    const selection = document.getSelection()
    const range =
      selection && !selection.isCollapsed && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null
    const node = range
      ? range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement
      : null
    const text = range ? selection!.toString().trim() : ''
    if (!range || !node || !frameNode.contains(node) || text.length < MIN_QUOTE_LENGTH) {
      quotedRef.current = null
      return setQuote(null)
    }

    if (quotedRef.current !== text) {
      quotedRef.current = text
      setCopied('idle')
    }
    const rect = range.getBoundingClientRect()
    const origin = content.getBoundingClientRect()
    setQuote({
      text,
      page: Number(node.closest('[data-page]')?.getAttribute('data-page')) || currentPageRef.current,
      x: rect.left - origin.left,
      y: rect.top - origin.top,
    })
  }, [quoteFormat, onFindSimilar])

  useEffect(() => {
    const frameNode = scrollRef.current
    if (!(quoteFormat || onFindSimilar) || !frameNode) return

    const collapse = (): void => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed) setQuote(null)
    }

    frameNode.addEventListener('pointerup', readSelection)
    frameNode.addEventListener('keyup', readSelection)
    document.addEventListener('selectionchange', collapse)
    return () => {
      frameNode.removeEventListener('pointerup', readSelection)
      frameNode.removeEventListener('keyup', readSelection)
      document.removeEventListener('selectionchange', collapse)
    }
  }, [quoteFormat, onFindSimilar, readSelection, doc])

  useEffect(() => {
    if (quotedRef.current) readSelection()
  }, [targetWidth, readSelection])

  const copyQuote = useCallback(async (): Promise<void> => {
    if (!quote || !quoteFormat) return
    try {
      await navigator.clipboard.writeText(quoteFormat({ text: quote.text, page: quote.page }))
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }, [quote, quoteFormat])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  return { readSelection, copyQuote }
}
