'use client'

import type { JSX } from 'react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, CheckCircle2, ChevronDown, FileText, XCircle } from 'lucide-react'

import {
  AnimatePresence,
  motion,
  motionBase,
  motionEntrance,
  motionInstant,
  motionQuick,
  motionQuickExit,
} from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemList } from '@/components/ui/item'
import { StageTrack, type StageTrackTone } from '@/components/ui/stage-track'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import { documentFilesHref } from '@/features/documents/lib/document-question'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import { RUN_PHASES, type RunStatus } from '@/lib/runs/run-ledger-types'
import {
  activePhase,
  basisReceipt,
  isLiveStatus,
  phaseState,
  runDisplayStatus,
  runTallies,
  stepsInPhase,
} from '@/lib/runs/run-vocabulary'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import { landingDelays, type LandingDelays } from '../lib/choreography'
import { docProvenance } from '../lib/doc-provenance'
import { completedBeforeLabel, statusLine } from '../lib/run-status-lines'
import { RunStatusGlyph } from './RunStatusGlyph'
import { isZdrPolicyRefusal } from '@/lib/model-config/zdr-refusal'
import { useCurrentProject } from '@/features/projects/lib/current-project'
import { PhaseActs } from './run-block/run-phase-acts'
import { RoundRow } from './run-block/run-round-row'
import { RunElapsed } from './run-block/run-elapsed'
import { WRAPPING_CHIP } from './run-block/run-doc-chip'
import type { RunBlockProps } from './run-block/run-block-props'

export type { RunBlockProps, RunBlockReview } from './run-block/run-block-props'

function trackTone(status: RunStatus): StageTrackTone {
  switch (status) {
    case 'done':
    case 'interrupted':
      return 'settled'
    case 'failed':
      return 'stopped'
    case 'cancelled':
      return 'retired'
    default:
      return 'moving'
  }
}

export function RunBlock({
  ledger,
  title,
  projectId,
  filesToProject,
  review,
  defaultOpen,
  onAnswer,
  onRetry,
  onCancel,
  onWriteNow,
  onAddDocument,
  addDocumentFailure,
  onOpenDocument,
  onContinue,
  connection,
  reviewHref,
  reportHref,
  live: streaming,
  className,
}: RunBlockProps): JSX.Element {
  const t = useTranslations(runsCopy)
  const reduced = useReducedMotion()
  const status = runDisplayStatus(ledger)
  const live = isLiveStatus(status)

  const landedFromRef = useRef(status)
  const landingRef = useRef<LandingDelays | null>(null)
  if (status !== landedFromRef.current) {
    landedFromRef.current = status
    landingRef.current = reduced ? null : landingDelays(status)
  }
  const landing = landingRef.current
  const tallies = runTallies(ledger)
  const statusWord = t(`status.${status}`)
  const name = title?.trim() || t('block.untitled')

  const [open, setOpen] = useState<boolean>(status === 'waiting' || (defaultOpen ?? live))
  const userToggledRef = useRef(false)
  const autoOpenedRef = useRef(defaultOpen ?? live)
  const prevLiveRef = useRef(live)
  useEffect(() => {
    if (live === prevLiveRef.current) return
    prevLiveRef.current = live
    if (!live) {
      const shouldFold = !userToggledRef.current && autoOpenedRef.current
      autoOpenedRef.current = false
      if (!shouldFold) return
      const after = landingRef.current?.fold
      if (after === null || after === undefined) {
        setOpen(false)
        return
      }
      const timer = setTimeout(() => setOpen(false), after * 1000)
      return () => clearTimeout(timer)
    }
  }, [live])
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const enteredWait = status === 'waiting' && prevStatusRef.current !== 'waiting'
    prevStatusRef.current = status
    if (enteredWait) setOpen(true)
  }, [status])
  const handleOpenChange = (next: boolean): void => {
    userToggledRef.current = true
    setOpen(next)
  }

  const reviewed = !!review
  const fileHref =
    status === 'done' && projectId && ledger.result?.fileId
      ? documentFilesHref(projectId, ledger.result.fileId)
      : null
  const action: ReactNode =
    status === 'waiting' && onAnswer ? (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-xs"
        onClick={onAnswer}
        data-testid="run-action-answer"
      >
        {t('action.answer')}
      </Button>
    ) : status === 'done' && !reviewed && reviewHref ? (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-xs"
        asChild
        data-testid="run-action-review"
      >
        <Link href={reviewHref}>{t('action.review')}</Link>
      </Button>
    ) : status === 'done' && reviewed && reportHref ? (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-xs"
        asChild
        data-testid="run-action-open-report"
      >
        <Link href={reportHref}>{t('action.openReport')}</Link>
      </Button>
    ) : (status === 'failed' || status === 'cancelled') && onRetry && !isZdrPolicyRefusal(ledger.error?.reason) ? (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onRetry}
        data-testid="run-action-retry"
      >
        {t('action.retry')}
      </Button>
    ) : fileHref ? (
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" asChild>
        <Link href={fileHref} data-testid="run-file-link">
          <FileText className="size-3.5" aria-hidden />
          {t('action.openInProject')}
        </Link>
      </Button>
    ) : null

  const writeNow: ReactNode =
    onWriteNow && live && activePhase(ledger) === 'researching' ? (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-xs"
        onClick={() => void onWriteNow()}
        data-testid="run-action-write-now"
      >
        {t('action.writeNow')}
      </Button>
    ) : null

  const addDocument: ReactNode =
    onAddDocument && live ? (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-7 gap-1 px-2 text-xs"
        onClick={onAddDocument}
        data-testid="run-action-add-document"
      >
        <BookOpen className="size-3.5" aria-hidden />
        {t('documents.addAction')}
      </Button>
    ) : null

  const receipt = basisReceipt(ledger)

  const closedProject = useCurrentProject()?.status === 'closed'
  const carryForward: ReactNode =
    closedProject && (status === 'done' || status === 'interrupted') ? (
      <span className="text-muted-foreground text-xs" data-testid="run-action-continue-closed">
        {t('action.continueClosed')}
      </span>
    ) : onContinue && (status === 'done' || status === 'interrupted') ? (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-7 px-2 text-xs"
        onClick={() => void onContinue()}
        data-testid="run-action-continue"
      >
        {t('action.continue')}
      </Button>
    ) : null

  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const stop: ReactNode =
    onCancel && live ? (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-7 px-2 text-xs"
        onClick={() => setConfirmingCancel(true)}
        data-testid="run-action-cancel"
      >
        {t('action.cancel')}
      </Button>
    ) : null

  const connectionLine =
    streaming && (connection === 'reconnecting' || connection === 'lost')
      ? t(`connection.${connection}`)
      : null

  const line = statusLine(t, ledger, status, tallies, filesToProject ?? false)
  const before =
    status === 'failed' || status === 'cancelled'
      ? completedBeforeLabel(t, ledger, tallies)
      : null
  const reviewLine = !review
    ? null
    : review.decision === 'accepted'
      ? review.by
        ? t('review.accepted', { name: review.by })
        : t('review.acceptedAnon')
      : review.reason
        ? t('review.rejected', { reason: review.reason })
        : t('review.rejectedAnon')

  const rounds = stepsInPhase(ledger, 'researching')
  const reached = RUN_PHASES.filter((phase) => phaseState(ledger, phase) === 'done').length
  const halted = !live && status !== 'done' && reached < RUN_PHASES.length
  const closing = before !== null || reviewLine !== null || connectionLine !== null

  return (
    <section
      aria-label={t('block.aria', { title: name, status: statusWord })}
      data-testid="run-block"
      data-status={status}
      className={cn(
        'border-border bg-card w-full overflow-hidden rounded-xl border',
        className
      )}
    >
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        {/* The stand: what it is, how long it has taken, where it stands — in
            that order, top to bottom, the way the document panel puts its badge
            over its track over its sentence. */}
        <div className="flex flex-col gap-2 px-3 py-2.5" data-testid="run-stand">
          {/* WRAPS. „Abbrechen" beside „Antworten" is the widest the stand ever
              gets, and at a phone's 390px it took the title down to three
              characters. Wrapping puts the clock and the buttons on their own
              line there and changes nothing where the row already fits. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <CollapsibleTrigger asChild>
              {/* No aria-label: it would override the visible content, which is
                  the title — and the state is on the section's own label. */}
              <button
                type="button"
                className="duration-snap focus-visible:ring-ring/60 group flex min-w-0 flex-1 basis-40 cursor-pointer items-center gap-2 rounded-md text-left outline-none transition-colors ease-out focus-visible:ring-2 motion-reduce:transition-none"
              >
                <RunStatusGlyph status={status} size="sm" delay={landing?.glyph ?? 0} />
                <span
                  className="text-foreground min-w-0 flex-1 break-words text-xs font-medium leading-snug line-clamp-2"
                  data-testid="run-title"
                >
                  {name}
                </span>
                <ChevronDown className="text-muted-foreground duration-quick size-3.5 shrink-0 transition-transform ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                <span className="sr-only">{t('block.toggle')}</span>
              </button>
            </CollapsibleTrigger>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <RunElapsed ledger={ledger} live={live} />
              {writeNow}
              {addDocument}
              {stop}
              {carryForward}
              {action}
            </span>
          </div>

          {/* Five segments, no labels: the line below names the one the run is
              in, so the track reads as a position rather than as a legend. */}
          <StageTrack
            stages={RUN_PHASES}
            reached={reached}
            active={live}
            halted={halted}
            tone={trackTone(status)}
            className="[&>span]:duration-base [&>span]:transition-colors [&>span]:ease-out motion-reduce:[&>span]:transition-none"
            data-testid="run-track"
          />

          {/* The one line that says where it stands. The spoken status word is a
              plain copy beside it: the visible line leads with the phase while
              the run is going, and a reader who cannot see the glyph would
              otherwise never hear „Läuft". */}
          <p
            className={cn(
              'text-xs leading-relaxed',
              status === 'failed' ? 'text-error' : 'text-muted-foreground'
            )}
            role={live ? 'status' : undefined}
            data-testid="run-status-line"
          >
            <span className="sr-only" data-testid="run-status-word">
              {statusWord}
            </span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={status}
                aria-hidden
                className="inline-block"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: reduced
                    ? motionInstant
                    : { ...motionQuick, delay: landing?.word ?? 0 },
                }}
                exit={{
                  opacity: 0,
                  transition: reduced
                    ? motionInstant
                    : { ...motionQuickExit, delay: landing?.word ?? 0 },
                }}
              >
                {line}
              </motion.span>
            </AnimatePresence>
          </p>

          {/* A refused or failed „Unterlage hinzufügen", where it was pressed:
              the picker has closed, and a document that silently never reached
              the run reads as one the run is about to read. */}
          {addDocumentFailure && (
            <p
              className="text-error flex items-start gap-1.5 text-xs leading-[1.5]"
              role="alert"
              data-testid="run-add-document-failure"
            >
              <XCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>{addDocumentFailure}</span>
            </p>
          )}
        </div>

        {/* The body grows out of the stand — height plus opacity, a
            user-initiated expand. `initial={false}` so a block that mounts open
            does not animate its way there. */}
        <AnimatePresence initial={false}>
          {open && (
            // eslint-disable-next-line grid/motion-vocabulary -- a fold the reader opened, below the stand they pressed; instant under reduced motion
            <motion.div
              key="run-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: 'auto',
                opacity: 1,
                transition: reduced ? motionInstant : motionBase,
              }}
              exit={{ height: 0, opacity: 0, transition: reduced ? motionInstant : motionQuick }}
              className="overflow-hidden"
              data-testid="run-body"
            >
              {/* The receipt: every document the reader named, read (with where)
                  or not. Above the rounds, because it is the promise the rounds
                  are measured against. */}
              {receipt.length > 0 && (
                <div
                  className="border-border flex flex-col gap-1 border-t px-3 py-2"
                  data-testid="run-basis"
                  aria-label={t('documents.receiptLabel')}
                >
                  <p className="text-muted-foreground text-xs font-medium">
                    {t('documents.receipt', {
                      read: receipt.filter((row) => row.read).length,
                      total: receipt.length,
                    })}
                  </p>
                  <ul className="flex flex-wrap gap-1" role="list">
                    {receipt.map((row) => {
                      const label = row.doc.title ?? row.doc.name
                      const loci = row.loci.join(' · ')
                      const body = (
                        <>
                          {label}
                          {row.read && loci && <span className="opacity-70"> · {loci}</span>}
                          {!row.read && <span className="italic"> · {t('documents.unread')}</span>}
                        </>
                      )
                      return (
                        <li
                          key={row.doc.name}
                          className="inline-flex max-w-full"
                          data-testid="run-basis-doc"
                          data-read={row.read ? 'true' : 'false'}
                        >
                          {onOpenDocument ? (
                            <button
                              type="button"
                              onClick={() => onOpenDocument(row.doc)}
                              className="focus-visible:ring-ring/60 max-w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2"
                              aria-label={t('documents.open', { name: label })}
                            >
                              <SourceSignalChip
                                signal={docProvenance(row.doc).tint}
                                className={cn('max-w-full', WRAPPING_CHIP, !row.read && 'opacity-75')}
                                title={row.doc.name}
                              >
                                {body}
                              </SourceSignalChip>
                            </button>
                          ) : (
                            <SourceSignalChip
                              signal={docProvenance(row.doc).tint}
                              className={cn('max-w-full', WRAPPING_CHIP, !row.read && 'opacity-75')}
                              title={row.doc.name}
                            >
                              {body}
                            </SourceSignalChip>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* The rounds: one hairline-separated row each, the history's own
                  shape. Keyed by step id, so an appended round is a new element
                  and the rows above it are the same ones, re-rendered. */}
              {rounds.length > 0 && (
                <ItemList as="ol" className="border-border rounded-none border-0 border-t">
                  <AnimatePresence initial={false}>
                    {rounds.map((step, index) => (
                      <RoundRow key={step.id} step={step} index={index} reduced={reduced} />
                    ))}
                  </AnimatePresence>
                </ItemList>
              )}

              <PhaseActs ledger={ledger} live={live} tallies={tallies} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* The closing rows sit BELOW the body, not inside it. A failed or
            cancelled run folds its body once it has said how it ended, and
            the sentence saying what it had finished by then (and a review)
            went with the fold: the reader was left with the verdict and not
            the reason. Outside, they rise after the fold and stay. */}
        {closing && (
          <motion.div
            key={`closing-${status}`}
            initial={landing ? { opacity: 0, y: 4 } : false}
            animate={{
              opacity: 1,
              y: 0,
              transition:
                reduced || !landing
                  ? motionInstant
                  : { ...motionEntrance, delay: landing.footer },
            }}
            className="border-border flex flex-col gap-1.5 border-t px-3 py-2"
            data-testid="run-footer"
          >
            {before && (
              <p
                className="text-muted-foreground text-xs leading-relaxed"
                data-testid="run-completed-before"
              >
                {before}
              </p>
            )}
            {reviewLine && review && (
              <Quote
                as="p"
                className="flex items-start gap-1.5 text-xs leading-[1.5]"
                data-testid="run-review"
                data-decision={review.decision}
              >
                {review.decision === 'accepted' ? (
                  <CheckCircle2 className="text-success mt-0.5 size-3 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="text-error mt-0.5 size-3 shrink-0" aria-hidden />
                )}
                <span>{reviewLine}</span>
              </Quote>
            )}
            {connectionLine && (
              <p
                className="text-muted-foreground text-xs leading-relaxed"
                role="status"
                data-testid="run-connection"
                data-connection={connection}
              >
                {connectionLine}
              </p>
            )}
          </motion.div>
        )}
      </Collapsible>

      {/* Asked once, and phrased around what survives: the rounds already
          researched stay on screen, which is the fact that decides the answer.
          Warning rather than destructive — a stopped run keeps its work. */}
      {onCancel && (
        <ConfirmDialog
          open={confirmingCancel}
          onOpenChange={setConfirmingCancel}
          title={t('cancel.confirmTitle')}
          description={t('cancel.confirmBody')}
          confirmLabel={t('cancel.confirm')}
          cancelLabel={t('cancel.keep')}
          tone="warning"
          onConfirm={onCancel}
          confirmTestId="run-cancel-confirm"
        />
      )}
    </section>
  )
}
