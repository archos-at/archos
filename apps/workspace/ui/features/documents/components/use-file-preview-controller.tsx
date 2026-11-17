import { INLINE_PREVIEW_CONTENT_TYPES, isRenditionSource } from '@/lib/documents/preview-types'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { isTextPageType } from './file-text-page'


import { MessageSquarePlus } from 'lucide-react'
import { firstFinding, quarantineVerdictOf, type QuarantineFinding } from '@/lib/upload-screening/quarantine'


import { useLocale, useTranslations } from '@/i18n'

import { filesCopy } from '@/i18n/namespaces/files'

import { inferDocumentKind } from '../document-kind'

import type { OpenMarksAtApproval } from './document-review-controls'

import type { SimilarPassagesRequest } from '@/lib/similar-passages/types'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { useMediaQuery } from '@/hooks/use-media-query'
import { PHONE_ON_ITS_SIDE_QUERY, PHONE_QUERY } from '@/hooks/use-is-mobile'

import { useDocumentActions, useMoveInSheet } from './document-actions'
import { isCitable, isCitableStatus, isNeverIndexed, isSettlingStatus } from './document-status'

import type { VisualDetail } from './page-readings'
import { useFileFacts } from '../hooks/use-file-facts'

import { showsRevisionsSection } from '@/lib/documents/revision-timeline'


import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { backLandsOn } from '@/lib/navigation/history-step'

import { useFilePreviewStore } from '../stores/file-preview-store'
import { useDocumentReview } from '../hooks/use-document-review'

import { useRoomCompany } from './review/document-review'
import { tabCounts } from './review/review-panel'

import { clearReviewParams, hrefWithParams, readReviewParams, reviewFilesHref, setReviewParams, type ReviewLinkTool } from '../lib/open-review'
import { readDocumentLocus } from '../lib/document-locus'
import { isLive, type MarkTally } from '@/lib/annotations/types'

import { ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentProject } from '@/features/projects/lib/current-project'

import { usePeekState } from './file-preview-peek-state'
import { useMailThreadRail } from './mail-thread/use-mail-thread-rail'
import { type ReaderAnnotate } from './file-preview-reader'
import { PRODUCT_NAME } from '@/lib/brand'

import type { FilePreviewPaneProps } from './file-preview-pane-props'
export type { FilePreviewPaneProps } from './file-preview-pane-props'

const PREVIEW_TYPES: readonly string[] = INLINE_PREVIEW_CONTENT_TYPES

const VISUAL_CONTENT_TYPES = ['drawing', 'image', 'chart']

export function useFilePreviewController(props: FilePreviewPaneProps) {
  const {
  file,
  projectId,
  projectName,
  canManage = true,
  lifecyclePermissions,
  viewerUserId,
  onLifecycleChanged,
  onMarksChanged,
  scope = 'files',
  onClose,
  onReingested,
  onTagsUpdated,
  onOpenDocument,
  onRevisionChanged,
  onRenamed,
  onDeleted,
  showMetadataPanel = true,
  showModels = true,
  canCollaborate = false,
  presentation = 'modal',
  onAssigneesChanged,
  } = props
  const t = useTranslations(filesCopy)
  const currentProject = useCurrentProject()
  const closedProjectName =
    currentProject?.status === 'closed' && scope !== 'officeShelf' && (projectId ?? currentProject.id) === currentProject.id
      ? (projectName ?? currentProject.name)
      : null
  const showIndexedSection = showMetadataPanel && !isNeverIndexed(file)
  const indexedReady = showIndexedSection && isCitableStatus(file.status)
  const indexedPending = showIndexedSection && isSettlingStatus(file.status)
  const showIndexedHeading = indexedReady || indexedPending
  const discussHint =
    file.authoredBy && file.authoredBy !== 'user' && isNeverIndexed(file) ? t('authorship.notInKnowledge') : undefined
  const reviewViewer =
    projectId && lifecyclePermissions ? { permissions: lifecyclePermissions, userId: viewerUserId } : undefined
  const assigneeNames = Object.fromEntries(
    (file.assignees ?? []).flatMap((person) => (person.name ? [[person.userId, person.name] as const] : [])),
  )
  const revisionsShown = showsRevisionsSection({
    facts: file.revision ?? null,
    versionCount: file.versionCount,
    hasViewer: reviewViewer !== undefined,
  })
  const storeMode = useFilePreviewStore((state) => state.mode)
  const storeFileId = useFilePreviewStore((state) => state.file?.id)
  const inChat =
    presentation === 'peek' ||
    presentation === 'expanded' ||
    ((storeMode === 'peek' || storeMode === 'expanded') && storeFileId === file.id)
  const peeking = presentation === 'peek'
  const moveInSheet = useMoveInSheet()
  const onPhone = useMediaQuery(PHONE_QUERY)
  const sideways = useMediaQuery(PHONE_ON_ITS_SIDE_QUERY)
  const reader = onPhone && !peeking
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => {
    setDetailsOpen(false)
  }, [file.id])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [renditionType, setRenditionType] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewGone, setPreviewGone] = useState(false)
  const [previewText, setPreviewText] = useState<{ text: string; truncated: boolean } | null>(null)
  const [isLargePreviewOpen, setIsLargePreviewOpen] = useState(false)
  const [details, setDetails] = useState<VisualDetail[] | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsFailed, setDetailsFailed] = useState(false)
  const [shownPage, setShownPage] = useState<number | 'turning' | null>(null)
  const turnFrame = useRef<number | null>(null)
  const kind = inferDocumentKind({
    filename: file.filename,
    contentType: file.contentType,
    tags: file.tags,
  })
  const isModel = kind === 'model'
  const isOfficeRendition = isRenditionSource(file)
  const canPreview = PREVIEW_TYPES.includes(file.contentType ?? '') || isOfficeRendition
  const isTextual = isTextPageType(file.contentType)
  const isImage = !isOfficeRendition && (file.contentType ?? '').startsWith('image/')
  const shownType = isOfficeRendition ? renditionType : file.contentType
  const canExpandPreview = shownType === 'application/pdf' || isImage
  const isFailed = file.status === 'failed'
  const isHeld = file.status === 'quarantined'
  const heldVerdict = useMemo(
    () => (isHeld ? quarantineVerdictOf({ quarantine: file.quarantine, errorMessage: file.errorMessage }) : null),
    [isHeld, file.quarantine, file.errorMessage]
  )
  const [shownFinding, setShownFinding] = useState<QuarantineFinding | null>(null)
  useEffect(() => {
    setShownFinding(firstFinding(heldVerdict))
  }, [file.id, heldVerdict])
  const fileFacts = useFileFacts(file)
  const responsibleNames = (file.assignees ?? [])
    .map((person) => person.name || person.email || '')
    .filter(Boolean)
    .join(', ')
  const hasVisualContent = (file.contentTypes ?? []).some((c) => VISUAL_CONTENT_TYPES.includes(c))
  const hasOwnershipBlock =
    file.authoredBy === 'agent' || canCollaborate || Boolean(projectId && !inChat)

  const previewRequest = useRef<AbortController | null>(null)
  const loadPreview = useCallback(() => {
    previewRequest.current?.abort()
    const request = new AbortController()
    previewRequest.current = request
    const { signal } = request
    setPreviewFailed(false)
    setPreviewGone(false)
    setPreviewUrl(null)
    setPreviewImageUrl(null)

    if (isTextual) {
      setPreviewText(null)
      setIsLoading(true)
      let gone = false
      fetch(`/api/documents/${file.id}/text`, { signal })
        .then(async (r) => {
          if (r.status === 404) {
            gone = true
            return null
          }
          return r.ok ? await r.json() : null
        })
        .then((data) => {
          if (signal.aborted) return
          if (typeof data?.text === 'string') {
            setPreviewText({ text: data.text, truncated: data.truncated === true })
          } else if (gone) {
            setPreviewGone(true)
          } else {
            setPreviewFailed(true)
          }
        })
        .catch(() => {
          if (signal.aborted) return
          setPreviewText(null)
          setPreviewFailed(true)
        })
        .finally(() => {
          if (!signal.aborted) setIsLoading(false)
        })
      return
    }

    setPreviewText(null)
    if (!canPreview) return

    setIsLoading(true)
    setRenditionType(null)
    let gone = false
    let noRendition = false
    fetch(`/api/documents/${file.id}/preview`, { signal })
      .then(async (r) => {
        if (isOfficeRendition && (r.status === 415 || r.status === 502)) {
          noRendition = true
          return null
        }
        if (r.status === 404) {
          gone = true
          return null
        }
        return r.ok ? await r.json() : null
      })
      .then((data) => {
        if (signal.aborted) return
        if (isOfficeRendition && data?.url && data.contentType !== 'application/pdf') {
          noRendition = true
        }
        if (noRendition) return
        if (data?.url) {
          if (isOfficeRendition) setRenditionType(data.contentType)
          setPreviewUrl(data.url)
          setPreviewImageUrl(typeof data.imageUrl === 'string' ? data.imageUrl : null)
        } else if (gone) {
          setPreviewGone(true)
        } else {
          setPreviewFailed(true)
        }
      })
      .catch(() => {
        if (signal.aborted) return
        setPreviewFailed(true)
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false)
      })
  }, [file.id, canPreview, isTextual, isOfficeRendition])

  const handlePdfFailed = useCallback(() => {
    setPreviewUrl(null)
    setPreviewImageUrl(null)
    setPreviewFailed(true)
  }, [])
  const [wellRef, wellSeen] = useSeenOnce<HTMLDivElement>()
  const showInlinePdf = wellSeen && !isLargePreviewOpen
  const pdfInWell = canPreview && Boolean(previewUrl) && shownType === 'application/pdf'
  const wellHostsViewer = peeking && (isModel || pdfInWell)
  const reviewEnabled = pdfInWell && showMetadataPanel && !isHeld
  const replacedBy = file.revision?.supersededBy ?? null
  const replaces = file.revision?.supersedes
  const reviewRevision = useMemo(() => ({ replacedBy, replaces: replaces ?? [] }), [replacedBy, replaces])
  const review = useDocumentReview(file.id, {
    enabled: reviewEnabled,
    viewerUserId,
    revision: reviewRevision,
    piloti: {
      projectId: scope === 'officeShelf' ? null : projectId,
      fileName: file.filename,
      versionState: file.versionState ?? null,
      shelf: 'project',
      chatHosted: inChat,
    },
  })
  const liveMarks = review.annotations.filter(isLive).length
  const marksForYou = useMemo(
    () => tabCounts(review.annotations, { on: true, me: review.me }).open,
    [review.annotations, review.me]
  )
  const shownMarks = file.marks ?? null
  useEffect(() => {
    if (!reviewEnabled || review.load !== 'ready' || !onMarksChanged) return
    const { open, proposed } = review.counts
    const tally: MarkTally | null = open + proposed > 0 ? { open, proposed, forYou: marksForYou } : null
    const same =
      tally === null
        ? shownMarks === null
        : shownMarks !== null &&
          shownMarks.open === tally.open &&
          shownMarks.proposed === tally.proposed &&
          shownMarks.forYou === tally.forYou
    if (!same) onMarksChanged(file.id, tally)
  }, [reviewEnabled, review.load, review.counts, marksForYou, shownMarks, onMarksChanged, file.id])
  const [reviewOpen, setReviewOpen] = useState(false)
  const inlineViewer = showInlinePdf && !reviewOpen
  const reviewPage = useRef<number | null>(null)
  const onReviewPage = useCallback((page: number) => {
    reviewPage.current = page
  }, [])
  const reviewWasOpen = useRef(false)
  useEffect(() => {
    const was = reviewWasOpen.current
    reviewWasOpen.current = reviewOpen
    if (reviewOpen) {
      if (!was) reviewPage.current = null
      return
    }
    const page = reviewPage.current
    reviewPage.current = null
    if (was && page !== null) setShownPage(page)
  }, [reviewOpen])
  const [reviewFocus, setReviewFocus] = useState<{ annotationId: string; key: number } | null>(null)
  const [reviewTool, setReviewTool] = useState<ReviewLinkTool | null>(null)
  const { setTool: setReviewToolInHand } = review
  const showReview = useCallback(
    (annotationId?: string | null, tool?: ReviewLinkTool | null) => {
      setReviewFocus(annotationId ? { annotationId, key: Date.now() } : null)
      setReviewTool(tool ?? null)
      if (tool) setReviewToolInHand(tool)
      setReviewOpen(true)
    },
    [setReviewToolInHand]
  )
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const reviewLink = readReviewParams(searchParams)
  const linkedLocus = readDocumentLocus(searchParams, file.id)
  const addressed = reviewLink.documentId === file.id || (reviewLink.documentId === null && inChat)
  const urlOpen = reviewLink.open && addressed && pdfInWell
  const pushedReview = useRef(false)
  const urlWasOpen = useRef(false)
  const reviewOpenRef = useRef(reviewOpen)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  const replaceParams = useCallback(
    (params: URLSearchParams, how: 'push' | 'replace' = 'replace') => {
      const href = hrefWithParams(pathname ?? '', params)
      if (how === 'push') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router]
  )
  useEffect(() => {
    const was = urlWasOpen.current
    urlWasOpen.current = urlOpen
    if (urlOpen && !was && !reviewOpenRef.current) showReview(reviewLink.annotationId, reviewLink.tool)
    if (!urlOpen && was && reviewOpenRef.current) {
      pushedReview.current = false
      setReviewOpen(false)
      setReviewToolInHand('select')
    }
  }, [urlOpen, reviewLink.annotationId, reviewLink.tool, showReview, setReviewToolInHand])
  const openReview = useCallback(
    (annotationId?: string, tool?: ReviewLinkTool) => {
      showReview(annotationId, tool)
      if (urlOpen || !addressed) return
      const params = setReviewParams(
        new URLSearchParams(searchParams?.toString() ?? ''),
        { documentId: file.id, annotationId, tool },
        { withDocument: false }
      )
      pushedReview.current = true
      replaceParams(params, 'push')
    },
    [showReview, urlOpen, addressed, searchParams, file.id, replaceParams]
  )
  const { peekView, setPeekView } = usePeekState(peeking, file.id, reviewEnabled ? openReview : null)
  const mailRail = useMailThreadRail({ projectId, file, peeking, reader, setPeekView, setDetailsOpen })
  const openMarks = useMemo((): OpenMarksAtApproval | null => {
    if (!reviewEnabled) return null
    const onOpen = () => openReview()
    if (review.load === 'ready') {
      return { status: 'counted', open: review.counts.open, proposed: review.counts.proposed, onOpen }
    }
    return review.load === 'loading' ? { status: 'loading' } : { status: 'unavailable', onOpen }
  }, [reviewEnabled, review.load, review.counts.open, review.counts.proposed, openReview])
  const linkTool: ReviewLinkTool | null = review.tool === 'point' || review.tool === 'region' ? review.tool : null
  useEffect(() => {
    if (!reviewOpen || !urlOpen) return
    if (reviewLink.annotationId === review.selectedId && reviewLink.tool === linkTool) return
    if (review.load !== 'ready' && reviewLink.annotationId && !review.selectedId) return
    replaceParams(
      setReviewParams(
        new URLSearchParams(searchParams?.toString() ?? ''),
        { documentId: file.id, annotationId: review.selectedId, tool: linkTool },
        { withDocument: false }
      )
    )
  }, [reviewOpen, urlOpen, reviewLink.annotationId, reviewLink.tool, review.selectedId, review.load, linkTool, searchParams, file.id, replaceParams])
  const onReviewOpenChange = useCallback(
    (open: boolean) => {
      if (open) return openReview()
      setReviewOpen(false)
      if (!urlOpen) return
      if (pushedReview.current) {
        pushedReview.current = false
        router.back()
        return
      }
      if (reviewLink.back) {
        if (backLandsOn(reviewLink.back)) router.back()
        else router.replace(reviewLink.back, { scroll: false })
        return
      }
      replaceParams(clearReviewParams(new URLSearchParams(searchParams?.toString() ?? '')))
    },
    [openReview, urlOpen, router, replaceParams, searchParams, reviewLink.back]
  )
  const popoutHref =
    projectId && scope !== 'officeShelf' && typeof window !== 'undefined'
      ? new URL(reviewFilesHref(projectId, { documentId: file.id }), window.location.origin).toString()
      : undefined
  const { locale } = useLocale()
  const company = useRoomCompany(review.room)
  const presenceNames = [...company.people.map((person) => person.name), ...(company.piloti ? [PRODUCT_NAME] : [])]
  const presenceSentence =
    presenceNames.length > 0
      ? t('annotations.peopleHere', {
          count: presenceNames.length,
          names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(presenceNames),
        })
      : null
  const annotateLead =
    reviewEnabled && review.load === 'ready' && review.canAnnotate && !reader ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarTextButton
            className="text-foreground gap-1 px-2 [&_svg]:size-3.5"
            data-testid="inline-annotate"
            onClick={() => openReview(undefined, 'point')}
          >
            <MessageSquarePlus aria-hidden />
            {t('annotations.annotate')}
          </ToolbarTextButton>
        </TooltipTrigger>
        <TooltipContent side="top">{t('annotations.annotateHint')}</TooltipContent>
      </Tooltip>
    ) : undefined
  const readerAnnotate: ReaderAnnotate | null =
    reviewEnabled && review.load === 'ready' && (review.canAnnotate || liveMarks > 0)
      ? {
          label: liveMarks > 0 ? t('annotations.section') : t('annotations.annotate'),
          count: liveMarks,
          countLabel: t('annotations.readerCount', { count: liveMarks }),
          onClick: () => (liveMarks > 0 ? openReview() : openReview(undefined, 'point')),
        }
      : null

  useEffect(() => {
    loadPreview()
    return () => previewRequest.current?.abort()
  }, [loadPreview])

  useEffect(() => {
    setDetails(null)
    setDetailsFailed(false)
    if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    turnFrame.current = null
    setShownPage(null)
  }, [file.id])
  useEffect(
    () => () => {
      if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    },
    [],
  )

  const detailsBasis = `${file.status ?? ''}|${(file.contentTypes ?? []).join(',')}`
  useEffect(() => {
    setDetails(null)
    setDetailsFailed(false)
  }, [detailsBasis])

  useEffect(() => {
    if (!showMetadataPanel || !hasVisualContent || details !== null) return
    let cancelled = false
    setDetailsLoading(true)
    fetch(`/api/documents/${file.id}/visual-details`)
      .then((r) => {
        if (!r.ok) throw new Error(`visual-details ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setDetails(Array.isArray(data?.details) ? data.details : [])
      })
      .catch(() => {
        if (cancelled) return
        setDetails([])
        setDetailsFailed(true)
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false)
      })
    return () => {
      cancelled = true
      setDetailsLoading(false)
    }
  }, [showMetadataPanel, hasVisualContent, details, file.id, detailsBasis])

  const showPage = useCallback((page: number) => {
    setPeekView('document')
    setShownPage('turning')
    if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    turnFrame.current = requestAnimationFrame(() => {
      turnFrame.current = null
      setShownPage(page)
    })
  }, [setPeekView])
  const viewerTarget = useFilePreviewStore((state) => (state.viewerTarget?.fileId === file.id ? state.viewerTarget : null))
  const viewerTargetKey = viewerTarget?.key ?? null
  const viewerTargetPage = viewerTarget?.page ?? null
  useEffect(() => {
    if (viewerTargetKey !== null && viewerTargetPage !== null) showPage(viewerTargetPage)
  }, [viewerTargetKey, viewerTargetPage, showPage])
  const retryDetails = useCallback(() => {
    setDetailsFailed(false)
    setDetails(null)
  }, [])

  const handleDeleted = useCallback(
    (fileId: string) => {
      onDeleted?.(fileId)
      onClose?.()
    },
    [onDeleted, onClose]
  )
  const actions = useDocumentActions({ document: file, scope, onReingested, onDeleted: handleDeleted })

  const handleReingest = useCallback(() => void actions.reingest(), [actions])

  const [similarAsk, setSimilarAsk] = useState<SimilarPassagesRequest | null>(null)
  const findSimilar = isCitable(file)
    ? ({ text, page }: { text: string; page: number }) =>
        setSimilarAsk({
          document: { kind: 'stored', documentId: file.id },
          passage: { text, page, cited: false },
          projectId: projectId ?? null,
        })
    : undefined

  return {
    actions,
    addressed,
    annotateLead,
    assigneeNames,
    canCollaborate,
    canExpandPreview,
    canManage,
    canPreview,
    closedProjectName,
    company,
    currentProject,
    details,
    detailsBasis,
    detailsFailed,
    detailsLoading,
    detailsOpen,
    discussHint,
    file,
    fileFacts,
    findSimilar,
    handleDeleted,
    handlePdfFailed,
    handleReingest,
    hasOwnershipBlock,
    hasVisualContent,
    heldVerdict,
    inChat,
    indexedPending,
    indexedReady,
    inlineViewer,
    isFailed,
    isHeld,
    isImage,
    isLargePreviewOpen,
    isLoading,
    isModel,
    isOfficeRendition,
    isTextual,
    kind,
    lifecyclePermissions,
    linkTool,
    linkedLocus,
    liveMarks,
    loadPreview,
    locale,
    marksForYou,
    moveInSheet,
    onAssigneesChanged,
    onClose,
    onDeleted,
    onLifecycleChanged,
    onMarksChanged,
    onOpenDocument,
    onPhone,
    onReingested,
    onRenamed,
    onReviewOpenChange,
    onReviewPage,
    onRevisionChanged,
    onTagsUpdated,
    openMarks,
    openReview,
    pathname,
    pdfInWell,
    peekView,
    peeking,
    popoutHref,
    presenceNames,
    presenceSentence,
    presentation,
    previewFailed,
    previewGone,
    previewImageUrl,
    previewRequest,
    previewText,
    previewUrl,
    projectId,
    projectName,
    pushedReview,
    reader,
    readerAnnotate,
    renditionType,
    replaceParams,
    replacedBy,
    replaces,
    responsibleNames,
    retryDetails,
    review,
    reviewEnabled,
    reviewFocus,
    reviewLink,
    reviewOpen,
    reviewOpenRef,
    reviewPage,
    reviewRevision,
    reviewTool,
    reviewViewer,
    reviewWasOpen,
    revisionsShown,
    router,
    scope,
    searchParams,
    setDetails,
    setDetailsFailed,
    setDetailsLoading,
    setDetailsOpen,
    setIsLargePreviewOpen,
    setIsLoading,
    setPeekView,
    setPreviewFailed,
    setPreviewGone,
    setPreviewImageUrl,
    setPreviewText,
    setPreviewUrl,
    setRenditionType,
    setReviewFocus,
    setReviewOpen,
    setReviewTool,
    setReviewToolInHand,
    setShownFinding,
    setShownPage,
    setSimilarAsk,
    showIndexedHeading,
    showIndexedSection,
    showInlinePdf,
    showMetadataPanel,
    showModels,
    showPage,
    showReview,
    shownFinding,
    shownMarks,
    shownPage,
    shownType,
    sideways,
    similarAsk,
    storeFileId,
    storeMode,
    t,
    turnFrame,
    urlOpen,
    urlWasOpen,
    viewerTarget,
    viewerTargetKey,
    viewerTargetPage,
    viewerUserId,
    wellHostsViewer,
    wellRef,
    wellSeen,
    ...mailRail,
  }
}

export type FilePreviewController = ReturnType<typeof useFilePreviewController>
