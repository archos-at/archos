'use client'

import { type FC, type ReactNode, memo, useId, useMemo, useState, useTransition } from 'react'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { cn } from '@/lib/utils'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import {
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  CircleHelp,
  CircleMinus,
  Circle,
  TriangleAlert,
} from 'lucide-react'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { motion, AnimatePresence, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { SectionLabel } from '@/components/ui/section-label'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useLayoutStore } from '@/features/layout/store'
import type { CitationSource } from '../types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import { deriveTraceLanes } from '../lib/trace-lanes'
import { buildCitationModel } from '../lib/citations'
import { liveLine } from '../lib/turn-events'
import { deriveExecutedSteps } from '../lib/executed-steps'
import { useElapsedSeconds, formatElapsed, type ElapsedSince } from '../hooks/use-elapsed-seconds'
import { useThrottledText } from '../hooks/use-throttled-text'
import { ReasoningFlow } from './reasoning/ReasoningFlow'
import { SubagentGroups } from './reasoning/SubagentGroups'
import { derivationOverview, documentLocation } from '../lib/derivation-basis'
import { hasActions } from '../lib/work-list'
import { settledHead, workParts } from '../lib/work-sentence'
import { answerSourceAnchorPrefix, citationNumbers, isCited } from '../lib/citations'
import { CitationScope } from './CitationScope'
import { CitationMarkers } from './CitationMarker'
import { documentEdition, documentShortName } from '../lib/document-names'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import {
  type HeaderStatus,
  type ThinkingEnding,
  answerAsksBack,
  headerStatus,
  headerWarning,
  isSettledAnswer,
  worstFinding,
} from '../lib/derivation-header'
import { type Disclosure, nextDisclosure } from '../lib/thinking-disclosure'
import { splitCount } from '../lib/split-count-label'
import { ROLL_OFFSET, type RollMotion } from './chat-thinking/roll-motion'
import { contentVariants } from './chat-thinking/disclosure-motion'
import { RollingCount } from './chat-thinking/rolling-count'
import { StatusIcon } from './chat-thinking/status-icon'

export type { ThinkingEnding }

export interface ChatThinkingProps {
  steps: StoredThinkingStep[]
  isThinking?: boolean
  isInterrupted?: boolean
  isRecoveryPending?: boolean
  isWaiting?: boolean
  isStopped?: boolean
  endedAs?: ThinkingEnding
  enabledDataSources?: string[]
  messageFiles?: Array<{ id: string; fileName: string }>
  userQuestion?: string
  answerConfidence?: 'low' | 'medium' | 'high'
  citations?: CitationSource[]
  confidenceCheck?: ConfidenceCheck
  answerText?: string
  answerId?: string
  escalationReason?: string
  retrievalLedger?: RetrievalLedger
  answering?: boolean
  since?: ElapsedSince
  answerDurationMs?: number
  defaultOpen?: boolean
  autoOpen?: boolean
}

const JOIN = '\u00A0· '

const PHASE_NOTE_MIN_GAP_MS = 3000

const ChatThinkingView: FC<ChatThinkingProps> = ({
  steps,
  isThinking = true,
  isInterrupted = false,
  isRecoveryPending = false,
  isWaiting = false,
  isStopped = false,
  endedAs,
  messageFiles = [],
  userQuestion = '',
  answerConfidence,
  citations,
  confidenceCheck,
  answerText,
  answerId,
  escalationReason,
  retrievalLedger,
  answering = false,
  since,
  answerDurationMs,
  defaultOpen = false,
  autoOpen,
}) => {
  const t = useTranslations(chatCopy)
  const reducedMotion = useReducedMotion()
  const showTechnicalSteps = useLayoutStore((s) => s.showTechnicalReasoning)

  const [disclosure, setDisclosure] = useState<Disclosure>(() => ({
    open: autoOpen ?? defaultOpen,
    closeReason: 'toggle',
    autoOpen,
    userToggled: false,
    autoOpened: autoOpen ?? defaultOpen,
  }))
  const derived = nextDisclosure(disclosure, autoOpen)
  if (derived !== disclosure) setDisclosure(derived)
  const { open, closeReason } = derived

  const [opening, startOpening] = useTransition()
  const handleOpenChange = (next: boolean) => {
    const apply = () =>
      setDisclosure((d) => ({ ...d, open: next, closeReason: 'toggle', userToggled: true }))
    if (next && !isThinking) startOpening(apply)
    else apply()
  }

  const sourceCards = useMemo(
    () => buildCitationModel({ traceLanes: deriveTraceLanes(steps), citations }),
    [steps, citations]
  )
  const fallbackId = useId()
  const anchorPrefix = answerSourceAnchorPrefix(answerId ?? fallbackId)
  const citationScope = (node: ReactNode) => (
    <CitationScope documents={sourceCards} anchorPrefix={anchorPrefix}>
      {node}
    </CitationScope>
  )
  const sourceCount = sourceCards.length

  const overview = useMemo(() => derivationOverview(steps, sourceCards), [steps, sourceCards])
  const citedCount = overview.cited

  const liveActivity = liveLine(steps, t)
  const activityLabel = liveActivity ?? t('thinking.working')
  const elapsedSeconds = useElapsedSeconds(isThinking || isWaiting, since)
  const [sawLive, setSawLive] = useState(isThinking)
  if (isThinking && !sawLive) setSawLive(true)

  const phaseNote = isThinking
    ? answering
      ? t('thinking.working')
      : t('thinking.inProgress')
    : isWaiting
      ? t('thinking.waiting')
      : isInterrupted
        ? isRecoveryPending
          ? t('thinking.recovering')
          : t('thinking.interrupted')
        : ''
  const spokenPhase = useThrottledText(phaseNote, PHASE_NOTE_MIN_GAP_MS)

  const executedSteps = useMemo(() => {
    const rowsDrawn = hasActions(steps)
    const derivedSteps = deriveExecutedSteps(steps, t).filter((s) => !rowsDrawn || s.skill)
    if (isThinking) return derivedSteps
    return derivedSteps.filter((s) => !s.skill)
  }, [steps, t, isThinking])

  const hasSignal =
    steps.length > 0 ||
    messageFiles.length > 0 ||
    Boolean(answerConfidence) ||
    (citations?.length ?? 0) > 0 ||
    Boolean(escalationReason?.trim()) ||
    userQuestion.trim().length > 0

  if (!hasSignal) {
    return null
  }

  const summaryLabel =
    [
      citedCount > 0 || overview.steps > 0 ? t('thinking.derivationSummary') : null,
      overview.steps > 0 ? t('thinking.derivationSteps', { count: overview.steps }) : null,
      citedCount > 0 ? t('thinking.derivationCited', { count: citedCount }) : null,
    ]
      .filter(Boolean)
      .join(JOIN) ||
    (sourceCount > 0
      ? t('thinking.derivationSummaryWithSources', { count: sourceCount })
      : t('thinking.derivationSummary'))

  const worst = worstFinding(confidenceCheck)
  const status = headerStatus({
    isThinking,
    isWaiting,
    isInterrupted,
    isRecoveryPending,
    isStopped,
    endedAs,
    asksBack: answerAsksBack(answerText, citedCount),
    worst,
  })
  const statusLabel: Record<HeaderStatus, string> = {
    live: answering ? t('thinking.working') : t('thinking.inProgress'),
    waiting: t('thinking.waiting'),
    recovering: t('thinking.recovering'),
    interrupted: t('thinking.interrupted'),
    stopped: t('thinking.stopped'),
    failed: t('thinking.failed'),
    handedOff: t('thinking.handedOff'),
    refused: t('thinking.refused'),
    askedBack: t('thinking.askedBack'),
    flagged: t('thinking.flagged'),
    done: t('thinking.done'),
  }
  const shimmer = status === 'live' && !answering
  const label = shimmer ? activityLabel : summaryLabel
  const countParts = shimmer ? null : splitCount(summaryLabel)
  const labelKey = shimmer
    ? `live:${label}`
    : countParts
      ? `summary:${countParts.before}#${countParts.after}`
      : `summary:${label}`
  const pill = headerWarning(status, worst, overview)
  const warning = pill && {
    ...pill,
    text: t(`thinking.derivationWarning.${pill.kind}`, { count: pill.count }),
  }
  const phaseWord = statusLabel[status]
  const endingWord = status === 'live' || status === 'done' || status === 'flagged' ? null : statusLabel[status]

  const shownSeconds =
    !isThinking && answerDurationMs !== undefined
      ? Math.max(Math.floor(answerDurationMs / 1000), sawLive ? elapsedSeconds : 0)
      : elapsedSeconds
  const showElapsed = sawLive && shownSeconds > 2 && (isThinking || isWaiting)

  const enter = reducedMotion ? motionInstant : motionQuick
  const leave = reducedMotion ? motionInstant : motionQuickExit
  const swap = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: enter },
    exit: { opacity: 0, transition: leave },
  }
  const roll: RollMotion = {
    initial: { opacity: 0, y: ROLL_OFFSET },
    animate: { opacity: 1, y: 0, transition: enter },
    exit: { opacity: 0, y: `-${ROLL_OFFSET}`, transition: { ...leave, y: enter } },
  }

  const researched = overview.researched || (retrievalLedger?.length ?? 0) > 0
  if (isSettledAnswer(status) && !researched && !escalationReason?.trim() && !showTechnicalSteps) {
    const askedBack = status === 'askedBack'
    const Glyph = askedBack ? CircleHelp : status === 'flagged' ? TriangleAlert : CircleMinus
    const tone = askedBack ? 'text-brand' : status === 'flagged' ? 'text-warning' : 'text-muted-foreground'
    return (
      <div
        data-testid={askedBack ? 'derivation-asked-back' : 'derivation-no-research'}
        className="bg-muted w-full rounded-surface px-4 py-3 shadow-xs"
      >
        <p className="text-foreground flex min-h-6 items-center gap-2 text-sm font-medium">
          <Glyph aria-hidden className={cn('size-5 shrink-0', tone)} />
          {t(askedBack ? 'thinking.askedBackHeadline' : 'thinking.noResearch')}
          {warning && JOIN + warning.text}
        </p>
        <p className="text-muted-foreground pl-7 text-[13px] leading-[19px]">
          {t(askedBack ? 'thinking.askedBackNote' : 'thinking.noResearchNote')}
        </p>
      </div>
    )
  }
  if (status === 'done' && !worst && overview.single && !showTechnicalSteps) {
    const call = overview.single
    const parts = workParts(t, call.action)
    const card = sourceCards[0]
    const cited = card && isCited(card) ? citationNumbers(card) : []
    const name = card ? documentShortName(card.fileName ?? card.title, card.title) : ''
    const head = settledHead(t, call.action, name)
    const detail = [
      card ? documentEdition(card.fileName ?? card.title, card.title) : undefined,
      card ? documentLocation(t, card) : parts.result || undefined,
    ].filter(Boolean)
    const [citedBefore = '', citedAfter = ''] = t('thinking.singleCited').split('{markers}')
    const citedPart =
      cited.length > 0 ? (
        <>
          {citedBefore}
          <CitationMarkers numbers={cited} />
          {citedAfter}
        </>
      ) : null
    return citationScope(
      <div
        data-testid="derivation-single"
        className="bg-muted grid w-full grid-cols-[20px_minmax(0,1fr)] gap-x-2 rounded-surface px-4 py-3 shadow-xs"
      >
        <CheckCircle2 aria-hidden className="text-success size-5" />
        <p className="text-sm leading-5 [overflow-wrap:anywhere]">
          <span className="text-foreground font-medium">{head}</span>
          {(detail.length > 0 || citedPart) && (
            <span className="text-muted-foreground block text-[13px] leading-[19px]">
              {detail.join(JOIN)}
              {detail.length > 0 && citedPart && JOIN}
              {citedPart}
            </span>
          )}
        </p>
      </div>
    )
  }

  return citationScope(
    <div className="@container w-full rounded-surface bg-muted shadow-xs">
      <Collapsible open={open || opening} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger asChild aria-controls={undefined /* no CollapsibleContent to name */}>
          {/* The trigger's name is the PHASE and the panel (`sr-only` below),
              not the visual line: the live activity phrase changes with every
              step, and a button whose name changes that often is re-read on
              every change, a queue of phrases already out of date. The
              phase is announced from a status outside the button. */}
          <button
            type="button"
            data-derivation-trigger
            className={cn(
              'group relative flex min-h-12 w-full cursor-pointer items-center justify-between rounded-control px-4 py-3 text-left outline-none transition-colors duration-snap ease-out motion-reduce:transition-none',
              FOCUS_RING_INSET
            )}
          >
            <span className="sr-only">
              {[phaseWord, summaryLabel, warning?.text].filter(Boolean).join(' · ')}
            </span>
            {/* `relative`: `popLayout` lifts the leaving icon and phrase out of
                the flow, positioned against this box. */}
            {/* One line in every state: the warning pill arrives at the
                settle, and a row that wrapped for it grew the header under
                the reader's eye. The label gives way (ellipsis) instead; the
                trigger's `sr-only` name above carries it whole. */}
            <span
              className="relative flex min-w-0 flex-nowrap items-center gap-x-2"
              aria-hidden="true"
            >
              {/* Fixed icon slot, shared by every state: without it the text
                  starts at a different x whenever the status changes, and the
                  row visibly jumps at the moment the reader looks at it. */}
              <AnimatePresence mode="popLayout" initial={false}>
                <StatusIcon key={status} status={status} t={t} enter={enter} leave={leave} />
              </AnimatePresence>
              {/* The label rolls: the old one leaves upward, fading, while the
                  new one rises into its place from below, overlapping
                  (`popLayout`) inside a clip one line tall. Neither `wait` nor
                  a cross-fade at one origin: `wait` left the header with no
                  label for a few frames at the fold and the settle, and two
                  phrases superimposed at one origin read as one garbled word
                  („Fertigtung"). Offset vertically, they never share a
                  position while both are legible.

                  Keyed by the label's WORDS, not its count: when only the
                  source count changes (it often does at the settle), this
                  node stays and only the digits roll (`RollingCount`). */}
              <span className="relative max-w-[calc(100%-1.75rem)] min-w-0 overflow-y-clip">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={labelKey}
                    data-derivation-label
                    className={cn(
                      'block truncate text-sm font-medium',
                      shimmer ? undefined : 'text-foreground'
                    )}
                    {...roll}
                  >
                    {/* The one ambient loop before the answer: the shimmer, on an
                        inner element that moves by transform only, since the
                        roll owns this span's opacity. */}
                    {shimmer ? (
                      <ShimmerText className="block">{label}</ShimmerText>
                    ) : countParts ? (
                      <>
                        {countParts.before}
                        <RollingCount value={countParts.count} after={countParts.after} roll={roll} />
                      </>
                    ) : (
                      label
                    )}
                  </motion.span>
                </AnimatePresence>
              </span>
              {warning && (
                <span
                  data-testid="derivation-warning"
                  className="bg-card text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[13px] font-medium"
                >
                  {warning.kind !== 'open' ? (
                    <TriangleAlert aria-hidden strokeWidth={2.4} className="size-3" />
                  ) : (
                    <Circle aria-hidden strokeWidth={2.4} className="size-3" />
                  )}
                  {/* A narrow panel keeps the summary whole and the pill to
                      its shape and count; the trigger's `sr-only` name and
                      the panel's „Offen“ carry the words. */}
                  <span className="@sm:hidden">{warning.count}</span>
                  <span className="hidden @sm:inline">{warning.text}</span>
                </span>
              )}
            </span>

            <span className="relative flex shrink-0 items-center gap-2" aria-hidden="true">
              {/* The ending word rolls like the label beside it. `wait` left
                  the slot empty for the whole exit before the next word came. */}
              <span className="relative overflow-y-clip empty:hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  {endingWord && (
                    <motion.span key={endingWord} className="block text-xs font-medium text-muted-foreground" {...roll}>
                      {endingWord}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                {showElapsed && (
                  <motion.span
                    key="elapsed"
                    className="min-w-[3.5ch] text-right text-xs font-medium tabular-nums text-muted-foreground"
                    {...swap}
                  >
                    {formatElapsed(shownSeconds)}
                  </motion.span>
                )}
              </AnimatePresence>
              {/* While the label is the activity, the summary sits here once
                  the PANEL is 28rem wide: beside it, at 390 px, the label read
                  only „Such…" (Herleitung audit, 2026-09). A container query,
                  not `sm:`: a wide window with a narrow chat column is a phone
                  to this header. From the answer's first word the label IS the
                  summary, and this slot stays empty for good. */}
              {shimmer && <span className="hidden text-xs text-muted-foreground @md:inline">{summaryLabel}</span>}
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-quick ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
            </span>
          </button>
        </CollapsibleTrigger>

        {/* Expanded content. It fades in (no height: growing it laid the page
            out on every frame while the graph inside was still mounting, 300–
            417 ms frame gaps on a phone, Herleitung audit 2026-09).

            How it leaves depends on why (`custom`). The FOLD, when the answer
            starts: the content fades on the exit easing with its height held,
            then gives up its height in one frame while invisible, so the reader
            never watches a box slide. A reader's own close keeps the collapse
            (height and opacity together), on the exit easing. Reduced motion:
            both instant. `overflow-hidden` so the collapse clips. */}
        <AnimatePresence initial={false} custom={{ reason: closeReason, reducedMotion }}>
          {open && (
            <motion.div
              key="derivation-content"
              custom={{ reason: closeReason, reducedMotion }}
              variants={contentVariants}
              initial="hidden"
              animate="shown"
              exit="leave"
              className="overflow-hidden [overflow-anchor:none]"
            >
              <div>
                  <div className="border-base border-t px-2 pb-3 pt-3 sm:px-4">
                    <ReasoningFlow
                      steps={steps}
                      userQuestion={userQuestion}
                      answerConfidence={answerConfidence}
                      citations={citations}
                      escalationReason={escalationReason}
                      retrievalLedger={retrievalLedger}
                      live={isThinking}
                      sourceCards={sourceCards}
                    />
                  </div>

                  {/* The subagents the turn ran (AG-UI 1.0 SUBAGENT_*), nested; nothing without one. */}
                  <SubagentGroups steps={steps} className="border-base border-t px-4 pb-3 pt-3" />

                  {/* Executed steps — what actually ran, as compact chips, under
                      the graph; a running one breathes. */}
                  {executedSteps.length > 0 && (
                    <div className="border-base flex flex-col gap-2 border-t px-4 pb-3 pt-3">
                      <SectionLabel>{t('thinking.executedSteps')}</SectionLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {executedSteps.map((s) => (
                          <span
                            key={s.key}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-control bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {s.running && (
                              <span
                                aria-hidden="true"
                                className="size-1.5 animate-caret-breathe rounded-full bg-brand motion-reduce:animate-none"
                              />
                            )}
                            {/* A skill with no authored title is named by its bare
                                `/identifier`, so the identifier half renders
                                `font-mono` — the same way `SkillsUsedDisclosure`
                                writes it under the finished answer. One label
                                authority, one appearance. */}
                            {s.mono ? (
                              <>
                                {s.prefix && <span>{s.prefix}</span>}
                                <span className="font-mono">{s.mono}</span>
                              </>
                            ) : (
                              s.label
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Collapsible>

      {/* The phase, said politely and at most every few seconds — outside the
          button, on a region mounted with the panel. A settled or stopped turn
          is said by the thread (`ChatArea`), once, with the answer's gist. */}
      <span className="sr-only" role="status" aria-live="polite">
        {spokenPhase}
      </span>

      {/* Mid-turn drop notice: a silent reconnect can leave a turn without any
          response. The collapsed header only shows a muted "Interrupted" chip,
          which does not tell the user what to do — so surface a compact,
          always-visible line (protocol-robustness item 4). While recovery is
          still in flight (FIX 3) show a calm "checking for a finished answer"
          line; only once recovery has settled with nothing found do we prompt
          a resend. */}
      {isInterrupted && isRecoveryPending ? (
        <div className="flex items-start gap-2 border-t border-border px-4 pb-3 pt-2.5">
          <Spinner
            size="xs"
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-xs leading-relaxed text-muted-foreground" role="status">
            {t('thinking.recoveringNotice')}
          </span>
        </div>
      ) : isInterrupted ? (
        <div className="flex items-start gap-2 border-t border-border px-4 pb-3 pt-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="text-xs leading-relaxed text-muted-foreground" role="status">
            {t('thinking.interruptedNotice')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export const ChatThinking = memo(ChatThinkingView)
