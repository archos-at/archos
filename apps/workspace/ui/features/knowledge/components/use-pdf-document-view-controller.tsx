import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { InsetStage } from '@/components/ui/inset-stage'

import { capturePosthog } from '@/lib/analytics/posthog'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { useMediaQuery } from '@/hooks/use-media-query'

import { documentParameters, loadPdfjs, readPageTextItems } from '../lib/pdfjs-runtime'
import { pageTextChunks } from '../lib/pdf-text-chunks'
import { canvasMeasure } from '../lib/canvas-measure'
import type { PageRegion } from '../lib/page-region'
import { buildPassageIndex, findOccurrences, MIN_SEARCH_QUERY, normalizePassage, passageBounds, type HighlightRect, type PassageIndex } from '../lib/passage-highlight'
import { anchoredTransform, clampPage, clampZoom, fitWidth, maxZoomFor, stepZoom, viewerKeyAction, type FitMode } from '../lib/pdf-zoom'

import { ContentTransform } from '../lib/content-transform'
import { useZoomGestures, type ZoomCommit } from '../lib/use-zoom-gestures'

import { MAX_SEARCH_RADIUS, searchRadius, pagesWithin, PLACEHOLDER_PAGE_ASPECT, GUTTER, TOUCH_GUTTER, PASSAGE_SCROLL_OFFSET, DETAIL_SETTLE_MS, CURRENT_PAGE_BAND, COPIED_FEEDBACK_MS, MIN_QUOTE_LENGTH, PassageHit, QuoteSelection, FIT_PAGE_PADDING, RERASTER_DELAY_MS, SEARCH_DEBOUNCE_MS, ANNOUNCE_DELAY_MS, SearchHit, ZoomAnchor, createViewSignal, prefersReducedMotion, LoadState, passwordState, scrollBehavior, pageShare } from './pdf-document-view-helpers'
import { HostGround } from './pdf-document-view-chrome'

export interface PdfDocumentViewProps {
  src: string
  title: string
  page?: number | null
  highlight?: string | null
  highlightColor?: string
  regions?: readonly PageRegion[] | null
  quoteFormat?: (quote: { text: string; page: number }) => string
  onFindSimilar?: (passage: { text: string; page: number }) => void
  onLoadError?: () => void
  ground?: 'stage' | 'host'
  bleed?: boolean
  pageOverlay?: (page: number) => ReactNode
  toolbarLead?: ReactNode
  focus?: { page: number; y: number; key: string | number; instant?: boolean } | null
  onViewport?: (viewport: { page: number; y: number }) => void
  className?: string
}

export function usePdfDocumentViewController(props: PdfDocumentViewProps) {
  const {
  src,
  title,
  page,
  highlight,
  highlightColor,
  regions,
  quoteFormat,
  onFindSimilar,
  onLoadError,
  ground = 'stage',
  bleed = false,
  pageOverlay,
  toolbarLead,
  focus,
  onViewport,
  className,
  } = props
  const t = useTranslations(knowledgeCopy)
  const coarse = useMediaQuery('(pointer: coarse)')
  const gutter = coarse ? TOUCH_GUTTER : GUTTER
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [attempt, setAttempt] = useState(0)
  const [password, setPassword] = useState<string | null>(null)
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [chosenFit, setFit] = useState<FitMode | null>(null)
  const [railOpen, setRailOpen] = useState(true)
  const [hit, setHit] = useState<PassageHit | null>(null)
  const [defaultAspect, setDefaultAspect] = useState<number | null>(null)
  const [firstPageWidth, setFirstPageWidth] = useState<number | null>(null)
  const [ping, setPing] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [announced, setAnnounced] = useState('')
  const [missed, setMissed] = useState<number[]>([])
  const [quote, setQuote] = useState<QuoteSelection | null>(null)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>([])
  const [activeHit, setActiveHit] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const quotedRef = useRef<string | null>(null)
  const foundRef = useRef(false)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const pageWidths = useRef(new Map<number, number>())
  const pageIndexes = useRef(new Map<number, PassageIndex>())
  const zoomRef = useRef(1)
  const anchorRef = useRef<ZoomAnchor | null>(null)
  const [stackTransform] = useState(() => new ContentTransform())
  const [viewSignal] = useState(createViewSignal)
  const currentPageRef = useRef(1)
  currentPageRef.current = currentPage

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

  const fit: FitMode = chosenFit ?? (defaultAspect !== null && defaultAspect < 1 ? 'page' : 'width')
  const baseWidth = fitWidth({
    mode: fit,
    frameWidth: frame.width,
    frameHeight: frame.height,
    aspect: defaultAspect ?? PLACEHOLDER_PAGE_ASPECT,
    gutter,
    verticalPadding: FIT_PAGE_PADDING,
  })
  const targetWidth = frame.width > gutter ? baseWidth * zoom : 0
  const maxZoom = maxZoomFor({ pageWidth: firstPageWidth, fitWidth: baseWidth })
  const maxZoomRef = useRef(maxZoom)
  maxZoomRef.current = maxZoom

  const setContentNode = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      stackTransform.attach(node)
    },
    [stackTransform],
  )

  const applyAnchor = useCallback(() => {
    const anchor = anchorRef.current
    const frameNode = scrollRef.current
    const content = contentRef.current
    if (!anchor || !frameNode || !content) {
      stackTransform.release()
      return
    }
    anchorRef.current = null
    stackTransform.clear()
    const box = frameNode.getBoundingClientRect()
    const before = content.getBoundingClientRect()
    const pageNode = anchor.page === null ? undefined : pageRefs.current.get(anchor.page)
    const point = pageNode
      ? {
          x: pageNode.offsetLeft + anchor.fx * pageNode.offsetWidth,
          y: pageNode.offsetTop + anchor.fy * pageNode.offsetHeight,
        }
      : { x: anchor.contentX * anchor.ratio, y: anchor.contentY * anchor.ratio }
    frameNode.scrollTop = before.top - box.top + frameNode.scrollTop + point.y - anchor.y
    frameNode.scrollLeft = before.left - box.left + frameNode.scrollLeft + point.x - anchor.x
    const after = content.getBoundingClientRect()
    stackTransform.settle(
      anchoredTransform({
        scale: anchor.shown / zoomRef.current,
        point,
        origin: { x: after.left, y: after.top },
        at: { x: box.left + anchor.x, y: box.top + anchor.y },
      }),
      { animate: !prefersReducedMotion() },
    )
  }, [stackTransform])

  const commitZoom = useCallback(
    (commit: ZoomCommit) => {
      const frameNode = scrollRef.current
      const target = clampZoom(commit.target, maxZoomRef.current)
      const drawn = zoomRef.current
      if (frameNode) {
        const box = frameNode.getBoundingClientRect()
        const pending = anchorRef.current
        anchorRef.current = pending
          ? { ...pending, x: commit.clientX - box.left, y: commit.clientY - box.top, ratio: pending.ratio * (target / drawn) }
          : {
              x: commit.clientX - box.left,
              y: commit.clientY - box.top,
              ...pageShare(pageRefs.current, commit.contentX, commit.contentY),
              contentX: commit.contentX,
              contentY: commit.contentY,
              ratio: target / drawn,
              shown: commit.shown,
            }
      }
      if (Math.abs(target - drawn) < 1e-4) {
        applyAnchor()
        return
      }
      zoomRef.current = target
      setZoom(target)
    },
    [applyAnchor],
  )

  useLayoutEffect(() => {
    applyAnchor()
  }, [targetWidth, applyAnchor])

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const frameNode = scrollRef.current
      const content = contentRef.current
      if (!frameNode || !content) {
        zoomRef.current = clampZoom(next, maxZoomRef.current)
        setZoom(zoomRef.current)
        return
      }
      stackTransform.finish()
      const box = frameNode.getBoundingClientRect()
      const stack = content.getBoundingClientRect()
      const x = clientX ?? box.left + frameNode.clientWidth / 2
      const y = clientY ?? box.top + frameNode.clientHeight / 2
      commitZoom({
        target: next,
        shown: zoomRef.current,
        clientX: x,
        clientY: y,
        contentX: x - stack.left,
        contentY: y - stack.top,
      })
    },
    [commitZoom, stackTransform],
  )

  const fitAgain = useCallback(() => zoomTo(1), [zoomTo])

  useZoomGestures(scrollRef, {
    enabled: Boolean(doc),
    contentRef,
    transform: stackTransform,
    zoom,
    maxZoom,
    onCommit: commitZoom,
  })

  useEffect(() => {
    const frameNode = scrollRef.current
    if (!frameNode || !doc) return
    let timer: number | null = null
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        if (!stackTransform.active) viewSignal.emit()
      }, DETAIL_SETTLE_MS)
    }
    frameNode.addEventListener('scroll', schedule, { passive: true })
    const stopRest = stackTransform.onRest(schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      frameNode.removeEventListener('scroll', schedule)
      stopRest()
    }
  }, [doc, stackTransform, viewSignal])

  useEffect(() => {
    if (!doc || targetWidth <= 0) return
    const timer = window.setTimeout(() => {
      if (!stackTransform.active) viewSignal.emit()
    }, DETAIL_SETTLE_MS + RERASTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [doc, targetWidth, stackTransform, viewSignal])

  const registerPage = useCallback((number: number, node: HTMLDivElement | null) => {
    if (node) pageRefs.current.set(number, node)
    else pageRefs.current.delete(number)
  }, [])

  const registerWidth = useCallback((number: number, width: number) => {
    pageWidths.current.set(number, width)
  }, [])

  const regionsOnPage = page && regions?.length ? regions : null

  const scrollToRegion = useCallback(
    (smooth: boolean) => {
      const frameNode = scrollRef.current
      const pageNode = page ? pageRefs.current.get(page) : undefined
      if (!frameNode || !pageNode || !regionsOnPage) return
      const top = Math.min(...regionsOnPage.map((region) => region.box[1]))
      const pageTop =
        pageNode.getBoundingClientRect().top - frameNode.getBoundingClientRect().top + frameNode.scrollTop
      const offset = pageTop + top * pageNode.clientHeight - frameNode.clientHeight * PASSAGE_SCROLL_OFFSET
      frameNode.scrollTo({ top: Math.max(0, offset), behavior: scrollBehavior(smooth) })
    },
    [page, regionsOnPage],
  )

  const scrollToRects = useCallback((target: { page: number; rects: HighlightRect[] }, smooth: boolean) => {
    const frameNode = scrollRef.current
    const pageNode = pageRefs.current.get(target.page)
    const bounds = passageBounds(target.rects)
    if (!frameNode || !pageNode || !bounds) return
    const box = frameNode.getBoundingClientRect()
    const pageBox = pageNode.getBoundingClientRect()
    const unscaled = pageWidths.current.get(target.page)
    const scale = unscaled && pageBox.width ? pageBox.width / unscaled : 1
    const pageTop = pageBox.top - box.top + frameNode.scrollTop
    const top = pageTop + bounds.y * scale - frameNode.clientHeight * PASSAGE_SCROLL_OFFSET
    const pageLeft = pageBox.left - box.left + frameNode.scrollLeft
    const left = pageLeft + (bounds.x + bounds.width / 2) * scale - frameNode.clientWidth / 2
    frameNode.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: scrollBehavior(smooth),
    })
  }, [])

  const revealPassage = useCallback(
    (target: PassageHit) => {
      setPing((previous) => previous + 1)
      scrollToRects(target, true)
    },
    [scrollToRects],
  )

  const handlePassage = useCallback(
    (found: PassageHit) => {
      if (foundRef.current) return
      foundRef.current = true
      setHit(found)
      revealPassage(found)
    },
    [revealPassage],
  )

  const handleMiss = useCallback((missedPage: number) => {
    setMissed((current) =>
      current.includes(missedPage) ? current : [...current, missedPage],
    )
  }, [])

  const radius = searchRadius(page, missed, doc?.numPages ?? 0)

  useEffect(() => {
    if (!hit || !defaultAspect) return
    const raf = requestAnimationFrame(() => scrollToRects(hit, false))
    return () => cancelAnimationFrame(raf)
  }, [hit, defaultAspect, scrollToRects])

  useEffect(() => {
    if (!doc || !page || hit) return
    if (regionsOnPage) scrollToRegion(false)
    else pageRefs.current.get(page)?.scrollIntoView({ block: 'start' })
  }, [doc, page, hit, defaultAspect, regionsOnPage, scrollToRegion])

  useEffect(() => {
    const frameNode = scrollRef.current
    if (!doc || !frameNode || typeof IntersectionObserver === 'undefined') return
    const inBand = new Map<number, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.page)
          if (Number.isFinite(number)) inBand.set(number, entry.isIntersecting)
        }
        const [first] = [...inBand]
          .filter(([, isInBand]) => isInBand)
          .map(([number]) => number)
          .sort((a, b) => a - b)
        if (first) setCurrentPage(first)
      },
      { root: frameNode, rootMargin: CURRENT_PAGE_BAND },
    )
    pageRefs.current.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [doc])

  const position = doc ? t('viewer.pagePosition', { page: currentPage, count: doc.numPages }) : ''
  useEffect(() => {
    if (!position) return
    const timer = window.setTimeout(() => setAnnounced(position), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [position])

  const goToPage = useCallback(
    (requested: number) => {
      const frameNode = scrollRef.current
      if (!doc || !frameNode) return
      const target = clampPage(requested, doc.numPages)
      const pageNode = pageRefs.current.get(target)
      if (!pageNode) return
      const top =
        pageNode.getBoundingClientRect().top - frameNode.getBoundingClientRect().top + frameNode.scrollTop
      setCurrentPage(target)
      frameNode.scrollTo({ top: Math.max(0, top - 12), behavior: scrollBehavior(true) })
    },
    [doc],
  )

  const focusKey = focus ? `${focus.key}` : null
  const focusRef = useRef(focus)
  focusRef.current = focus
  useEffect(() => {
    const frameNode = scrollRef.current
    const focus = focusRef.current
    if (!focus || !doc || !frameNode) return
    const pageNode = pageRefs.current.get(clampPage(focus.page, doc.numPages))
    if (!pageNode) return
    const frameBox = frameNode.getBoundingClientRect()
    const pageBox = pageNode.getBoundingClientRect()
    const pointTop = pageBox.top - frameBox.top + frameNode.scrollTop + focus.y * pageBox.height
    frameNode.scrollTo({
      top: Math.max(0, pointTop - frameBox.height / 2),
      behavior: scrollBehavior(!focus.instant),
    })
  }, [focusKey, doc])

  const onViewportRef = useRef(onViewport)
  onViewportRef.current = onViewport
  const reportsViewport = onViewport !== undefined
  useEffect(() => {
    const frameNode = scrollRef.current
    if (!frameNode || !doc || !reportsViewport) return
    let frame: number | null = null
    const report = () => {
      frame = null
      const frameBox = frameNode.getBoundingClientRect()
      const middle = frameBox.top + frameBox.height / 2
      for (const [number, node] of pageRefs.current) {
        const box = node.getBoundingClientRect()
        if (box.top <= middle && box.bottom >= middle && box.height > 0) {
          onViewportRef.current?.({ page: number, y: Math.min(1, Math.max(0, (middle - box.top) / box.height)) })
          return
        }
      }
    }
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(report)
    }
    frameNode.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      frameNode.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [doc, reportsViewport])

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

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const queryTooShort = normalizePassage(searchedQuery).length < MIN_SEARCH_QUERY

  useEffect(() => {
    if (!doc || !searchOpen || queryTooShort) {
      setHits([])
      return
    }
    let cancelled = false
    setHits(null)
    const run = async (): Promise<void> => {
      const found: SearchHit[] = []
      for (let number = 1; number <= doc.numPages; number += 1) {
        let index = pageIndexes.current.get(number)
        if (!index) {
          const pdfPage = await doc.getPage(number)
          if (cancelled) return
          const items = await readPageTextItems(pdfPage)
          if (cancelled) return
          const unscaled = pdfPage.getViewport({ scale: 1 })
          pageWidths.current.set(number, unscaled.width)
          index = buildPassageIndex(pageTextChunks(items, unscaled.transform), canvasMeasure())
          pageIndexes.current.set(number, index)
        }
        for (const rects of findOccurrences(index, searchedQuery)) found.push({ page: number, rects })
      }
      if (cancelled) return
      setHits(found)
      const ahead = found.findIndex((entry) => entry.page >= currentPageRef.current)
      setActiveHit(ahead === -1 ? 0 : ahead)
    }
    void run().catch(() => {
      if (!cancelled) setHits([])
    })
    return () => {
      cancelled = true
    }
  }, [doc, searchOpen, searchedQuery, queryTooShort])

  const shownHit = hits?.[activeHit] ?? null
  useEffect(() => {
    if (shownHit) scrollToRects(shownHit, true)
  }, [shownHit, scrollToRects])

  const stepHit = useCallback(
    (direction: 1 | -1) => {
      if (!hits?.length) return
      setActiveHit((current) => (current + direction + hits.length) % hits.length)
    },
    [hits],
  )

  const searchMarks = useMemo(() => {
    const byPage = new Map<number, Array<{ rects: HighlightRect[]; active: boolean }>>()
    hits?.forEach((entry, index) => {
      const list = byPage.get(entry.page) ?? []
      list.push({ rects: entry.rects, active: index === activeHit })
      byPage.set(entry.page, list)
    })
    return byPage
  }, [hits, activeHit])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setSearchFocus((value) => value + 1)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setSearchedQuery('')
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!doc || event.defaultPrevented) return
      const target = event.target as HTMLElement
      const frameNode = scrollRef.current
      const action = viewerKeyAction(event, {
        inField: target.closest('input, textarea, [contenteditable="true"]') !== null,
        overflowsSideways: frameNode ? frameNode.scrollWidth > frameNode.clientWidth + 1 : false,
      })
      if (!action) return
      event.preventDefault()
      if (action.kind === 'search') return openSearch()
      if (action.kind === 'fit') return fitAgain()
      if (action.kind === 'zoom') return zoomTo(stepZoom(zoomRef.current, action.direction, maxZoomRef.current))
      const to = {
        next: currentPageRef.current + 1,
        previous: currentPageRef.current - 1,
        first: 1,
        last: doc.numPages,
      }[action.to]
      goToPage(to)
    },
    [doc, openSearch, fitAgain, zoomTo, goToPage],
  )

  const pages = useMemo(
    () => (doc ? Array.from({ length: doc.numPages }, (_, index) => index + 1) : []),
    [doc],
  )

  useEffect(() => {
    if (doc) capturePosthog('document_opened', { kind: 'pdf', library: 'pdfjs' })
  }, [doc])

  const candidatePages =
    doc && page && highlight
      ? pagesWithin(page, MAX_SEARCH_RADIUS, doc.numPages)
      : []
  const passageMissing =
    !hit && candidatePages.length > 0 && candidatePages.every((number) => missed.includes(number))

  const revealCited =
    hit || regionsOnPage
      ? () => {
          if (hit) return revealPassage(hit)
          setPing((previous) => previous + 1)
          scrollToRegion(true)
        }
      : undefined

  const Ground = ground === 'stage' ? InsetStage : HostGround
  return {
    Ground,
    activeHit,
    anchorRef,
    announced,
    applyAnchor,
    attempt,
    baseWidth,
    bleed,
    candidatePages,
    chosenFit,
    className,
    closeSearch,
    coarse,
    commitZoom,
    contentRef,
    copied,
    copyQuote,
    currentPage,
    currentPageRef,
    defaultAspect,
    doc,
    firstPageWidth,
    fit,
    fitAgain,
    focus,
    focusKey,
    focusRef,
    foundRef,
    frame,
    goToPage,
    ground,
    gutter,
    handleMiss,
    handlePassage,
    highlight,
    highlightColor,
    hit,
    hits,
    loadState,
    maxZoom,
    maxZoomRef,
    missed,
    onFindSimilar,
    onKeyDown,
    onLoadError,
    onViewport,
    onViewportRef,
    openSearch,
    page,
    pageIndexes,
    pageOverlay,
    pageRefs,
    pageWidths,
    pages,
    passageMissing,
    password,
    ping,
    position,
    query,
    queryTooShort,
    quote,
    quoteFormat,
    quotedRef,
    radius,
    railOpen,
    readSelection,
    regions,
    regionsOnPage,
    registerPage,
    registerWidth,
    reportsViewport,
    revealCited,
    revealPassage,
    scrollRef,
    scrollToRects,
    scrollToRegion,
    searchFocus,
    searchMarks,
    searchOpen,
    searchedQuery,
    setActiveHit,
    setAnnounced,
    setAttempt,
    setContentNode,
    setCopied,
    setCurrentPage,
    setDefaultAspect,
    setDoc,
    setFirstPageWidth,
    setFit,
    setFrame,
    setHit,
    setHits,
    setLoadState,
    setMissed,
    setPassword,
    setPing,
    setQuery,
    setQuote,
    setRailOpen,
    setSearchFocus,
    setSearchOpen,
    setSearchedQuery,
    setZoom,
    shownHit,
    src,
    stackTransform,
    stepHit,
    t,
    targetWidth,
    title,
    toolbarLead,
    viewSignal,
    zoom,
    zoomRef,
    zoomTo,
  }
}

export type PdfDocumentViewController = ReturnType<typeof usePdfDocumentViewController>
