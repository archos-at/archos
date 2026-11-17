import type { AgentResponseProps } from './agent-response-props'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { animate } from 'motion/react'
import {
  AnimatePresence,
  motion,
  motionBase,
  motionInstant,
  motionQuick,
  motionQuickExit,
  useMotionToken,
} from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { cn } from '@/lib/utils'
import type { PluggableList } from 'unified'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'

import { remarkCitationMarkers } from '@/features/layout/lib/citation-markers'
import { remarkFileReferences } from '@/features/layout/lib/file-reference-markers'
import { AnswerCardItem } from '@/features/cards/components/AnswerCards'
import { useDecidedProposals } from '@/features/cards/decided-proposals'
import {
  CALLOUT_SLOT_INDEX,
  hasPlacedCalloutMarker,
  remarkCardMarkers,
  unplacedCardIndices,
} from '@/features/cards/card-markers'

import { useChatStore } from '../../store'
import { registerShownText, useAnswerRevealStore } from '../../stores/answer-reveal-store'
import { useAnswerFileReferences } from '../../hooks/use-answer-file-references'

import { usePacedText } from '../../hooks/use-paced-text'
import {
  answerDocuments,
  answerSourceAnchorPrefix,
  buildCitationModel,
  proseLength,
  splitAnswerBody,
} from '../../lib/citations'

import { MemoryNotedChip } from '../MemoryNotedChip'
import { ViewerActionRow } from '../ViewerActionRow'
import { turnMemoryItems } from '../../lib/turn-memory'
import { usePersonalTurnNotes } from '../../stores/turn-notes-store'
import { answerMetaToAnatomy, summaryDuplicatesBody } from '../../lib/answer-meta-cards'
import { AnatomyBlock, AnatomyMasthead, mastheadShows } from '../AnswerAnatomy'

import { AnswerFeedback } from '../AnswerFeedback'
import { RetryThoroughButton } from '../RetryThoroughButton'
import { AnswerActions } from '../AnswerActions'
import { CardSlot, forgetArrivals } from '../CardSlotArrival'
import { projectKeysIn } from '@/lib/text/answer-directives'
import { type AnswerData } from '@/shared/components/MarkdownRenderer/answer-block-context'
import { AnswerProjectStrip } from '@/shared/components/MarkdownRenderer/project-binding'
import { useProjectFacts } from '../../hooks/use-project-facts'
import { isNotRegulated, searchedSources } from '../../lib/answer-data'

import { wireCitationNumbers, readSourceLabel } from './read-sources'

import { answerRole, StreamingCaret } from './answer-role'
import { LEDE_CLASS, SUMMARY_GAP, NO_DOCUMENTS, opensWithProse } from './answer-prose'

export function useAgentResponseController({
  content,
  timestamp,
  answerDurationMs,
  variant = 'default',
  cards,
  citations,
  conversationId,
  cardInteractions,
  stages,
  answerMeta,
  findings,
  previousFindings,
  onCommissionFinding,
  answerConfidence,
  answerConfidenceCappedReason,
  answerConfidenceReason,
  confidenceCheck,
  answerConfidenceVersion,
  lookupFoundNothing,
  citationsRemoved,
  readSources,
  researchTruncated,
  truncationReason,
  degradedReasons,
  skillsActivated,
  skillsHidden,
  showReasoning = false,
  messageId,
  isStreaming = false,
  routingDecision,
  readOnly = false,
  retrievalLedger,
  quoteStamps,
  projectProfile,
  stopped = false,
  failed = false,
}: AgentResponseProps) {
  const t = useTranslations(chatCopy)
  const storeProjectId = useChatStore((s) => s.projectId)
  const projectId = readOnly ? null : storeProjectId
  const cardMessageId = readOnly ? undefined : messageId
  const projectFacts = useProjectFacts(storeProjectId, projectProfile)
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)
  const answerData = useMemo(
    (): AnswerData => ({
      project: projectFacts ?? undefined,
      prefill: readOnly ? undefined : setComposerPrefill,
      searched: searchedSources(retrievalLedger),
      quoteStamps,
      notRegulated: isNotRegulated(answerMeta),
    }),
    [projectFacts, readOnly, setComposerPrefill, retrievalLedger, quoteStamps, answerMeta]
  )
  const fallbackId = useId()
  const anchorPrefix = answerSourceAnchorPrefix(messageId ?? fallbackId)
  const prose = useMemo(() => content.slice(0, proseLength(content)), [content])
  const [mountedLive] = useState(isStreaming)
  const [wroteBefore, setWroteBefore] = useState(false)
  const anatomy = useMemo(() => answerMetaToAnatomy(answerMeta), [answerMeta])
  const summary = anatomy?.summary
  const [keptSummary, setKeptSummary] = useState<string>()
  const summaryDuplicates = useMemo(
    () => Boolean(summary) && summaryDuplicatesBody(summary, prose),
    [summary, prose]
  )
  const effectiveSummary =
    summary && (summary === keptSummary || !summaryDuplicates) ? summary : undefined
  const [summaryWritten, setSummaryWritten] = useState<boolean | null>(null)
  if (summaryWritten === null && effectiveSummary)
    setSummaryWritten(mountedLive && isStreaming && !wroteBefore)
  const lead = summaryWritten && effectiveSummary ? `${effectiveSummary}${SUMMARY_GAP}` : ''
  const paced = usePacedText(
    lead + prose,
    isStreaming,
    undefined,
    stopped || failed,
    messageId,
    lead.length
  )
  const pacedProse = paced.text.slice(lead.length)
  const shownSummary = lead ? paced.text.slice(0, effectiveSummary?.length) : effectiveSummary
  const writingSummary = Boolean(lead) && !paced.settled && paced.text.length < lead.length
  const cutShort = (stopped || failed) && mountedLive
  const settled = paced.settled
  const shownContent = pacedProse.length >= prose.length ? content : pacedProse
  const live = !settled
  const shownContentRef = useRef(shownContent)
  useLayoutEffect(() => {
    if (!messageId || !live) return
    return registerShownText(messageId, () => shownContentRef.current)
  }, [messageId, live])

  const hasMasthead = Boolean(anatomy && (anatomy.verdict || anatomy.summary || anatomy.topic))
  const hasLiveMasthead = live && hasMasthead
  const blank =
    (!content || !content.trim() || content === 'null') &&
    (cards?.length ?? 0) === 0 &&
    !(hasMasthead && (live || stopped || failed))
  if (mountedLive && live && !wroteBefore && shownContent.trim()) setWroteBefore(true)
  const retracted =
    mountedLive &&
    isStreaming &&
    wroteBefore &&
    (blank || (!shownContent.trim() && !hasLiveMasthead))
  const lastWords = useRef('')
  useLayoutEffect(() => {
    shownContentRef.current = shownContent
    if (shownContent.trim()) lastWords.current = shownContent
  })
  const [retractionFaded, setRetractionFaded] = useState(false)
  if (!retracted && retractionFaded) setRetractionFaded(false)
  const drawnContent = retracted ? (retractionFaded ? '' : lastWords.current) : shownContent
  const finishing = live && !isStreaming
  const beginReveal = useAnswerRevealStore((s) => s.begin)
  const endReveal = useAnswerRevealStore((s) => s.end)
  useLayoutEffect(() => {
    if (!messageId || !live) return
    beginReveal(messageId)
    return () => endReveal(messageId)
  }, [messageId, live, beginReveal, endReveal])
  const {
    body,
    entries: sourceEntries,
    numbers: splitNumbers,
  } = useMemo(() => splitAnswerBody(drawnContent), [drawnContent])
  const citationNumbersKey = [...new Set([...splitNumbers, ...wireCitationNumbers(citations)])]
    .sort((a, b) => a - b)
    .join(',')
  const citationNumbers = useMemo(
    (): ReadonlySet<number> =>
      new Set(citationNumbersKey ? citationNumbersKey.split(',').map(Number) : []),
    [citationNumbersKey]
  )

  const cardCount = cards?.length ?? 0
  if (!retracted && effectiveSummary && effectiveSummary !== keptSummary)
    setKeptSummary(effectiveSummary)
  const stripKeys = useMemo(
    () => (prose.includes(':project[') ? projectKeysIn(prose) : []),
    [prose]
  )
  const [stripAbove] = useState(() => prose.includes(':project['))
  const role = answerRole(answerMeta?.kind, routingDecision, Boolean(answerMeta?.verdict))
  const opener = opensWithProse(prose, !isStreaming)
  const ledeNow = opener === true && role !== 'note' && !effectiveSummary && !anatomy?.topic
  const [frozenLede, setFrozenLede] = useState<boolean | null>(null)
  if (mountedLive && !retracted && frozenLede === null && opener !== null) setFrozenLede(ledeNow)
  if (
    retracted &&
    retractionFaded &&
    (frozenLede !== null || keptSummary !== undefined || summaryWritten !== null)
  ) {
    setFrozenLede(null)
    setSummaryWritten(null)
    setKeptSummary(undefined)
  }
  const ledeClass = (mountedLive ? frozenLede === true : ledeNow) ? LEDE_CLASS : ''
  const fileReferences = useAnswerFileReferences({
    body,
    projectId: storeProjectId,
    conversationId: conversationId ?? null,
  })
  const hasCallout = Boolean(anatomy?.callout)
  const markerPlugins = useMemo(
    (): PluggableList => [
      [remarkCitationMarkers, { numbers: citationNumbers, anchorPrefix, pending: true }],
      [remarkCardMarkers, { count: 0, callout: hasCallout, pending: true }],
      [remarkFileReferences, { fileNames: fileReferences.fileNames }],
    ],
    [citationNumbers, anchorPrefix, hasCallout, fileReferences.fileNames]
  )
  const nestedPlugins = useMemo(
    (): PluggableList => [[remarkCitationMarkers, { numbers: citationNumbers, anchorPrefix }]],
    [citationNumbers, anchorPrefix]
  )
  const fallbackCardIndices = useMemo(() => unplacedCardIndices(body, cardCount), [body, cardCount])
  const unplacedIsFinal = !live || ((cards?.length ?? 0) > 0 && shownContent === content)
  const [unplacedDrawnLive, setUnplacedDrawnLive] = useState(false)
  if (live && unplacedIsFinal && !unplacedDrawnLive) setUnplacedDrawnLive(true)
  const drawUnplaced = unplacedIsFinal && (!cutShort || unplacedDrawnLive)
  const anatomyBelow = useMemo(() => {
    if (!anatomy) return []
    if (anatomy.callout && hasPlacedCalloutMarker(body)) {
      return anatomy.below.filter((card) => card.type !== 'callout')
    }
    return anatomy.below
  }, [anatomy, body])
  const arrivalPrefix = messageId ?? fallbackId
  const renderCardSlot = useCallback(
    (index: number) => {
      if (index === CALLOUT_SLOT_INDEX) {
        if (!anatomy?.callout) return null
        return (
          <div className="mb-3">
            <AnatomyBlock card={anatomy.callout} />
          </div>
        )
      }
      const card = cards?.[index]
      const arrivalKey = `${arrivalPrefix}:${index}`
      if (!card) return <CardSlot arrivalKey={arrivalKey} refused={index < (cards?.length ?? 0)} />
      return (
        <CardSlot arrivalKey={arrivalKey}>
          <AnswerCardItem
            card={card}
            index={index}
            projectId={projectId}
            messageId={cardMessageId}
            decisionsMustPersist={readOnly}
          />
        </CardSlot>
      )
    },
    [cards, projectId, cardMessageId, anatomy?.callout, arrivalPrefix, readOnly]
  )
  useLayoutEffect(() => {
    if (retracted && retractionFaded) forgetArrivals(arrivalPrefix)
  }, [retracted, retractionFaded, arrivalPrefix])
  const documents = useMemo(
    () => buildCitationModel({ citations, entries: sourceEntries }),
    [citations, sourceEntries]
  )
  const hasAnswerSources = useMemo(() => answerDocuments(documents).length > 0, [documents])

  const decidedProposals = useDecidedProposals((state) => state.byId)
  const personalNotes = usePersonalTurnNotes(conversationId, messageId)
  const memoryItems = useMemo(
    () => turnMemoryItems({ stages, cards, cardInteractions, decidedProposals, personalNotes }),
    [stages, cards, cardInteractions, decidedProposals, personalNotes]
  )

  const hasConfidence =
    ['low', 'medium', 'high'].includes(answerConfidence ?? '') ||
    confidenceCheck?.status === 'unavailable'
  const hasFeedback = !readOnly && Boolean(messageId)
  const hasAnswerActions =
    !readOnly && (live || (Boolean(content) && content.trim().length > 0 && content !== 'null'))
  const hasMetaRow =
    hasConfidence || hasFeedback || hasAnswerActions || Boolean(timestamp) || memoryItems.length > 0
  const reserveMetaRow = hasMetaRow || live
  const hasRenderableReadSources = (readSources ?? []).some(
    (source) => readSourceLabel(source) !== undefined
  )
  const hasDetailsContent =
    hasConfidence ||
    Boolean(timestamp) ||
    Boolean(answerDurationMs) ||
    (skillsActivated?.length ?? 0) > 0 ||
    Boolean(researchTruncated) ||
    (degradedReasons?.length ?? 0) > 0 ||
    (citationsRemoved?.count ?? 0) > 0 ||
    hasRenderableReadSources

  const diagramFilingTarget = useMemo(
    () =>
      projectId && messageId
        ? { projectId, answerId: messageId, ...(conversationId ? { conversationId } : {}) }
        : null,
    [projectId, messageId, conversationId]
  )

  const inert = live || failed
  const actionsContent = inert ? '' : content
  const actionsBody = inert ? '' : body
  const actionsDocuments = inert ? NO_DOCUMENTS : documents
  const answerActions = useMemo(
    () =>
      hasAnswerActions ? (
        <AnswerActions
          content={actionsContent}
          body={actionsBody}
          documents={actionsDocuments}
          conversationId={conversationId}
          messageId={messageId}
          pending={inert}
        />
      ) : null,
    [
      hasAnswerActions,
      actionsContent,
      actionsBody,
      actionsDocuments,
      conversationId,
      messageId,
      inert,
    ]
  )
  const memoryChip = useMemo(() => <MemoryNotedChip items={memoryItems} />, [memoryItems])
  const feedback = useMemo(
    () =>
      hasFeedback && messageId ? (
        <>
          {!inert && <RetryThoroughButton messageId={messageId} conversationId={conversationId} />}
          <AnswerFeedback
            compact
            pending={inert}
            messageId={messageId}
            conversationId={conversationId}
          />
        </>
      ) : null,
    [hasFeedback, messageId, conversationId, inert]
  )

  const proseRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const heightRelease = useMotionToken(motionBase)
  const frameHeight = useRef<number | null>(null)
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!mountedLive || !frame || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!frame.style.minHeight) frameHeight.current = frame.offsetHeight
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [mountedLive])
  const [footerReserved, setFooterReserved] = useState(!mountedLive)
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (footerReserved || !live || !frame || typeof ResizeObserver === 'undefined') return
    const check = () => {
      if (frame.getBoundingClientRect().bottom > window.innerHeight) setFooterReserved(true)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [footerReserved, live])
  const glideFrameDown = useCallback(
    (frame: HTMLElement, from: number): (() => void) | undefined => {
      frame.style.minHeight = ''
      const to = frame.offsetHeight
      const done = () => {
        frame.style.minHeight = ''
        frameHeight.current = frame.offsetHeight
      }
      if (to >= from - 1 || heightRelease === motionInstant) {
        done()
        return undefined
      }
      frame.style.minHeight = `${from}px`
      const controls = animate(frame, { minHeight: [`${from}px`, `${to}px`] }, heightRelease)
      void controls.then(done)
      return () => {
        controls.stop()
        frame.style.minHeight = ''
      }
    },
    [heightRelease]
  )
  const previousBody = useRef(body)
  const bodyFade = useMotionToken(motionBase)
  const bodyFadeControls = useRef<{ complete: () => void } | null>(null)
  useLayoutEffect(() => () => bodyFadeControls.current?.complete(), [])
  useLayoutEffect(() => {
    const previous = previousBody.current.trimEnd()
    previousBody.current = body
    if (stopped || failed) return
    if (!mountedLive || !previous || !body || body.startsWith(previous) || !proseRef.current) return
    bodyFadeControls.current?.complete()
    bodyFadeControls.current = animate(proseRef.current, { opacity: [0, 1] }, bodyFade)
    const frame = frameRef.current
    return frame && frameHeight.current !== null
      ? glideFrameDown(frame, frameHeight.current)
      : undefined
  }, [body, mountedLive, bodyFade, glideFrameDown, stopped, failed])

  const retractionFade = useMotionToken(motionQuickExit)
  useLayoutEffect(() => {
    const frame = frameRef.current
    const prose = proseRef.current
    if (!retracted || !frame || !prose) return
    if (frameHeight.current !== null) frame.style.minHeight = `${frameHeight.current}px`
    if (retractionFaded) return
    const controls = animate(prose, { opacity: [1, 0] }, retractionFade)
    const timer = window.setTimeout(
      () => setRetractionFaded(true),
      (retractionFade.duration ?? 0) * 1000
    )
    return () => {
      window.clearTimeout(timer)
      controls.stop()
      prose.style.opacity = ''
    }
  }, [retracted, retractionFaded, retractionFade])
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (retracted || !frame || !frame.style.minHeight) return
    return glideFrameDown(frame, frame.offsetHeight)
  }, [retracted, glideFrameDown])

  const mastheadExitToken = useMotionToken(motionQuickExit)
  const mastheadEnter = useMotionToken(motionQuick)
  const showMasthead =
    anatomy !== null &&
    mastheadShows({
      verdict: anatomy.verdict,
      summary: shownSummary,
      topic: anatomy.topic,
      kind: answerMeta?.kind,
    })
  const masthead = (
    <AnimatePresence initial={false}>
      {showMasthead && anatomy && (
        // eslint-disable-next-line grid/motion-vocabulary -- the fold after the fade: height goes in one frame (duration 0) once the masthead is invisible
        <motion.div
          key="masthead"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 0,
            height: 0,
            transition: {
              opacity: mastheadExitToken,
              height: { duration: 0, delay: mastheadExitToken.duration ?? 0 },
            },
          }}
          transition={mastheadEnter}
        >
          <AnatomyMasthead
            verdict={anatomy.verdict}
            summary={shownSummary}
            topic={anatomy.topic}
            context={anatomy.context}
            kind={answerMeta?.kind}
            caret={
              writingSummary && <StreamingCaret idle={paced.idle} veil={variant !== 'inline'} />
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  )

  const lateBlocks = (
    <AnimatePresence initial={false}>
      {!stripAbove && stripKeys.length > 0 && (
        <HeightArrival key="project-strip">
          <AnswerProjectStrip keys={stripKeys} />
        </HeightArrival>
      )}
      {!live && !cutShort && anatomyBelow.length > 0 && (
        <HeightArrival key="anatomy-below" className="mt-1 gap-3">
          {anatomyBelow.map((card) => (
            <AnatomyBlock key={card.type} card={card} />
          ))}
        </HeightArrival>
      )}
      {drawUnplaced && cards && fallbackCardIndices.length > 0 && (
        <HeightArrival key="unplaced-cards" className="mt-1 [&>:last-child]:mb-0">
          {fallbackCardIndices.map((index) => {
            const card = cards[index]
            if (!card) return null
            return (
              <CardSlot key={index} arrivalKey={`${arrivalPrefix}:${index}`} arriving={mountedLive}>
                <AnswerCardItem
                  card={card}
                  index={index}
                  projectId={projectId}
                  messageId={cardMessageId}
                  decisionsMustPersist={readOnly}
                />
              </CardSlot>
            )
          })}
        </HeightArrival>
      )}
    </AnimatePresence>
  )

  const dimmed = cn(
    'transition-opacity duration-base ease-out motion-reduce:transition-none',
    failed && 'opacity-60'
  )

  const stoppedMarker =
    stopped && !live ? (
      <p
        className={cn(
          'text-muted-foreground text-xs',
          mountedLive && 'animate-in fade-in-0 duration-quick ease-out motion-reduce:animate-none'
        )}
        data-testid="answer-stopped"
      >
        {t('answerStoppedMarker')}
      </p>
    ) : null

  const viewerActionRow = !readOnly && messageId ? <ViewerActionRow messageId={messageId} /> : null

  const retractionLine =
    retracted && retractionFaded ? (
      <motion.p
        className="text-muted-foreground text-sm"
        data-testid="answer-retracting"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={mastheadEnter}
      >
        {t('thinking.working')}
      </motion.p>
    ) : null

  const isNote = role === 'note'
  const kindLabel =
    role === 'note'
      ? t('roles.note')
      : role === 'answer'
        ? t('roles.answer')
        : t('roles.result')

  return {
    hidden: blank && !retracted,
    timestamp,
    answerDurationMs,
    conversationId,
    findings,
    previousFindings,
    onCommissionFinding,
    answerConfidence,
    answerConfidenceCappedReason,
    answerConfidenceReason,
    confidenceCheck,
    answerConfidenceVersion,
    lookupFoundNothing,
    citationsRemoved,
    readSources,
    researchTruncated,
    truncationReason,
    degradedReasons,
    skillsActivated,
    skillsHidden,
    showReasoning,
    messageId,
    routingDecision,
    stopped,
    failed,
    answerData,
    anchorPrefix,
    mountedLive,
    paced,
    writingSummary,
    cutShort,
    live,
    retracted,
    finishing,
    body,
    stripKeys,
    stripAbove,
    ledeClass,
    fileReferences,
    markerPlugins,
    nestedPlugins,
    renderCardSlot,
    documents,
    hasAnswerSources,
    hasConfidence,
    hasMetaRow,
    reserveMetaRow,
    hasDetailsContent,
    diagramFilingTarget,
    answerActions,
    memoryChip,
    feedback,
    proseRef,
    frameRef,
    footerReserved,
    masthead,
    lateBlocks,
    dimmed,
    stoppedMarker,
    viewerActionRow,
    retractionLine,
    isNote,
    kindLabel,
    hasFeedback,
    inert,
    variant,
  }
}
