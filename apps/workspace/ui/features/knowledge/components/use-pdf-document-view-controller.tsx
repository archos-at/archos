import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { InsetStage } from '@/components/ui/inset-stage'

import { capturePosthog } from '@/lib/analytics/posthog'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { useMediaQuery } from '@/hooks/use-media-query'

import { ContentTransform } from '../lib/content-transform'
import type { PassageIndex } from '../lib/passage-highlight'
import { fitWidth, maxZoomFor, stepZoom, viewerKeyAction, type FitMode } from '../lib/pdf-zoom'

import { usePdfDocumentLoad } from '../hooks/use-pdf-document-load'
import { usePdfPageNavigation } from '../hooks/use-pdf-page-navigation'
import { usePdfPassageScroll } from '../hooks/use-pdf-passage-scroll'
import { usePdfQuoteSelection } from '../hooks/use-pdf-quote-selection'
import { usePdfTextSearch } from '../hooks/use-pdf-text-search'
import { usePdfZoom } from '../hooks/use-pdf-zoom'

import {
  FIT_PAGE_PADDING,
  GUTTER,
  MAX_SEARCH_RADIUS,
  PLACEHOLDER_PAGE_ASPECT,
  TOUCH_GUTTER,
  createViewSignal,
  pagesWithin,
  type LoadState,
  type PassageHit,
  type QuoteSelection,
  type SearchHit,
  type ZoomAnchor,
} from './pdf-document-view-helpers'
import { HostGround } from './pdf-document-view-chrome'
import type { PdfDocumentViewProps } from './pdf-document-view-props'

export type { PdfDocumentViewProps } from './pdf-document-view-props'

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

  usePdfDocumentLoad({
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
  })

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

  const { setContentNode, applyAnchor, commitZoom, zoomTo, fitAgain } = usePdfZoom({
    scrollRef,
    contentRef,
    pageRefs,
    anchorRef,
    zoomRef,
    maxZoomRef,
    stackTransform,
    viewSignal,
    doc,
    zoom,
    setZoom,
    maxZoom,
    targetWidth,
  })

  const { registerPage, registerWidth, regionsOnPage, scrollToRegion, scrollToRects, revealPassage, handlePassage, handleMiss, radius } = usePdfPassageScroll({
    page,
    regions,
    doc,
    missed,
    setMissed,
    hit,
    setHit,
    defaultAspect,
    setPing,
    scrollRef,
    pageRefs,
    pageWidths,
    foundRef,
  })

  const position = doc ? t('viewer.pagePosition', { page: currentPage, count: doc.numPages }) : ''

  const { goToPage, focusKey, focusRef, onViewportRef, reportsViewport } = usePdfPageNavigation({
    focus,
    onViewport,
    position,
    doc,
    setCurrentPage,
    setAnnounced,
    scrollRef,
    pageRefs,
  })

  const { readSelection, copyQuote } = usePdfQuoteSelection({
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
  })

  const { queryTooShort, shownHit, stepHit, searchMarks, openSearch, closeSearch } = usePdfTextSearch({
    doc,
    query,
    setQuery,
    searchedQuery,
    setSearchedQuery,
    searchOpen,
    setSearchOpen,
    setSearchFocus,
    hits,
    setHits,
    activeHit,
    setActiveHit,
    pageIndexes,
    pageWidths,
    currentPageRef,
    scrollRef,
    scrollToRects,
  })

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
