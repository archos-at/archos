'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { AlertCircle, Ban, Check, ChevronDown, RotateCcw, ShieldAlert, WifiOff, X } from 'lucide-react'
import { mayRetryUpload, type TrackedFile } from '../types'
import {
  isDeterminate,
  summarizeTransfer,
  uploadPercent,
  uploadPhase,
  type TransferSummary,
  type UploadPhase,
} from '../lib/upload-progress'
import { useElapsedSeconds, useTransferRate } from '../hooks/use-transfer-rate'
import { FileExtChip } from './file-ext-chip'
import { IngestionStatusWord, ingestionMarkOfPhase } from './ingestion-atoms'
import { IngestFailureNotice } from './ingest-failure-notice'
import { HeldUploadReason } from './held-upload-reason'
import { HeldUploadDecision } from './held-upload-decision'
import { readAllowedRowAgain } from '../lib/read-allowed-row'
import { quarantineVerdictOf } from '@/lib/upload-screening/quarantine'
import { failedWhileReading } from '../lib/ingest-failure'
import { Button } from '@/components/ui/button'
import { AnimatePresence, iconSwapTransition, motion, motionBase, useMotionToken } from '@/components/motion'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatByteProgress, formatBytes, formatDurationShort, formatTransferRate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FilingSuggestionSlot, useFilingHighlighted } from './filing-suggestion'
import { FilingViewBar } from './filing-bar'
import { HIGHLIGHT_OUTLINE_INSET } from '@/components/ui/highlight'

interface UploadTrayProps {
  files: TrackedFile[]
  onRetry: (id: string) => void
  onCancel?: (id: string) => void
  onCancelAll?: () => void /* abort everything still in flight */
  onDismiss?: (ids: string[]) => void
  onOpenDocument?: (documentId: string) => void
  className?: string /* its plane where it lies: in Dateien a sheet on the column (`UPLOAD_TRAY_SHEET`) */
}

const VISIBLE_PHASES = new Set<UploadPhase>([
  'queued',
  'uploading',
  'processing',
  'ready',
  'held',
  'stored',
  'failed',
  'canceled',
])

const SUCCESS_LINGER_MS = 6_000

const ROW_NAME_TAIL = 20

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
const readOnline = (): boolean => navigator.onLine
const serverOnline = (): boolean => true

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, serverOnline)
}

export function UploadTray({ files, onRetry, onCancel, onCancelAll, onDismiss, onOpenDocument, className }: UploadTrayProps) {
  const foldTransition = useMotionToken(motionBase)
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [isExpanded, setIsExpanded] = useState(true)

  const visible = useMemo(() => files.filter((file) => VISIBLE_PHASES.has(uploadPhase(file))), [files])
  const summary = useMemo(() => summarizeTransfer(visible), [visible])
  const documentIds = useMemo(
    () => visible.flatMap((file) => (file.serverFileId ? [file.serverFileId] : [])),
    [visible]
  )

  const isTransferring = summary.stage === 'transferring'
  const isOnline = useOnline()
  const isWaitingForNetwork = isTransferring && !isOnline
  const { bytesPerSecond, etaSeconds } = useTransferRate(summary.uploadedBytes, summary.remainingBytes, isTransferring)

  const [processingSince, setProcessingSince] = useState<number | null>(null)
  useEffect(() => {
    setProcessingSince((current) => {
      if (summary.stage === 'processing') return current ?? Date.now()
      return null
    })
  }, [summary.stage])
  const processingElapsed = useElapsedSeconds(processingSince, summary.stage === 'processing')

  const dismissAll = useMemo(() => {
    if (!onDismiss) return undefined
    return () => onDismiss(visible.map((file) => file.id))
  }, [onDismiss, visible])

  const [isHeld, setIsHeld] = useState(false)
  useEffect(() => {
    if (visible.length === 0) setIsHeld(false)
  }, [visible.length])

  const isQuietSuccess =
    summary.isSettled && summary.failed === 0 && summary.held === 0 && summary.canceled === 0
  const dismissAllRef = useRef(dismissAll)
  useEffect(() => {
    dismissAllRef.current = dismissAll
  }, [dismissAll])
  const canRetire = isQuietSuccess && dismissAll !== undefined && !isHeld
  useEffect(() => {
    if (!canRetire) return
    const timer = setTimeout(() => dismissAllRef.current?.(), SUCCESS_LINGER_MS)
    return () => clearTimeout(timer)
  }, [canRetire])

  const retryAll = useMemo(() => {
    const failed = visible.filter((file) => uploadPhase(file) === 'failed' && mayRetryUpload(file))
    if (failed.length === 0) return null
    return () => failed.forEach((file) => onRetry(file.id))
  }, [visible, onRetry])

  const headline = trayHeadline(summary, t)
  const hasHeaderActions =
    (isTransferring && onCancelAll !== undefined) ||
    (summary.isSettled && retryAll !== null) ||
    (summary.isSettled && dismissAll !== undefined)
  const detail = isWaitingForNetwork
    ? t('uploads.detail.offline')
    : trayDetail(summary, { bytesPerSecond, etaSeconds, processingElapsed, locale, t })

  return (
    <AnimatePresence initial={false}>
      {visible.length > 0 && (
    // eslint-disable-next-line grid/motion-vocabulary -- the tray's arrival and retirement above the listing, a fold at the reading point; instant under reduced motion
    <motion.section
      key="upload-tray"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={foldTransition}
      aria-label={t('uploads.region')}
      data-testid="upload-tray"
      className={cn('shrink-0 overflow-hidden border-b bg-card', className)}
      onMouseEnter={() => setIsHeld(true)}
      onMouseLeave={() => setIsHeld(false)}
      onFocusCapture={() => setIsHeld(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsHeld(false)
      }}
    >
      {/* `flex-wrap`: the settled-with-failures state puts "Retry all",
          "Dismiss all" and the expander in this row, all `shrink-0`, so on a
          phone the summary — which is the only thing that says WHAT happened —
          took what was left of the width. Measured 33px: both its lines
          truncated to an ellipsis while three buttons sat beside them at full
          size. The summary now holds a readable floor and the actions drop to a
          second line when they no longer fit beside it. */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 phone:gap-2">
        <TrayGlyph summary={summary} offline={isWaitingForNetwork} />

        <button data-attr="files-toggle-expanded"
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          className="min-w-32 flex-1 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          {/* Polite, not assertive: the phase changes two or three times per
              batch and each one is worth hearing, but the byte counter beneath
              it updates every second and must never be announced. */}
          <p aria-live="polite" className="text-pretty text-sm font-medium leading-tight text-foreground" /* wraps, never cuts: „2 Dokumente werden hochgeladen“ lost its end at 768px */>
            {headline}
          </p>
          {/* Two lines, not one: on a phone the sentence that says why nothing
              is moving („Wird gelesen…", „Keine Verbindung…") is the part that
              was being cut off. */}
          <p aria-hidden className="line-clamp-2 text-xs leading-snug text-muted-foreground tabular-nums">
            {detail}
          </p>
        </button>

        {/* On a phone the actions take a line of their own under the
            headline, and the expander stays beside the headline it folds:
            wrapped in DOM order, it used to land alone on a third line. Even
            one action goes down: „Alle abbrechen" beside the headline's
            160px floor and the expander does not fit 390px, and the
            expander is what wrapped. */}
        {hasHeaderActions && (
          <div className={cn('flex items-center justify-end gap-3', summary.isSettled ? 'order-3 basis-full sm:order-2 sm:basis-auto' : 'order-2')}>
          {isTransferring && onCancelAll && (
            <Button type="button" variant="ghost" size="sm" className="-mx-2 shrink-0" onClick={onCancelAll}>
              {t('uploads.actions.cancelAll')}
            </Button>
          )}
          {summary.isSettled && retryAll && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={retryAll}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t('uploads.actions.retryAll')}
            </Button>
          )}
          {summary.isSettled && dismissAll && (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={dismissAll}>
              {t('uploads.actions.dismissAll')}
            </Button>
          )}
          </div>
        )}
        <button data-attr="files-toggle-expanded"
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? t('uploads.actions.collapse') : t('uploads.actions.expand')}
          className="order-2 flex size-7 shrink-0 sm:order-3 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:-m-2 pointer-coarse:size-11"
        >
          <ChevronDown
            className={cn(
              'size-4 transition-transform duration-quick ease-out motion-reduce:transition-none',
              isExpanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* Full-bleed batch track, hairline-thin and flush with the divider: it
          reads as a property of the whole panel rather than as another widget
          competing with the rows below. */}
      <TrackBar
        percent={isTransferring ? summary.bytesPercent : null}
        sweeping={summary.stage === 'processing'}
        testId="upload-tray-track"
      />

      {/* Where Piloti would file the batch, one line per target folder. Not
          inside the fold: collapsing the rows does not answer the question. */}
      <FilingViewBar documentIds={documentIds} minFiles={1} className="px-4 pb-1 pt-2.5" />

      <AnimatePresence initial={false}>
        {isExpanded && (
          // eslint-disable-next-line grid/motion-vocabulary -- the tray's own fold, opened by the reader below its header; instant under reduced motion
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={foldTransition}
            className="max-h-[42dvh] overflow-y-auto overscroll-contain"
          >
            {/* A dismissed row folds away rather than vanishing, so the rows
                under it slide up instead of jumping. */}
            <AnimatePresence initial={false}>
              {visible.map((file) => (
                <UploadRow
                  key={file.id}
                  file={file}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onDismiss={onDismiss}
                  onOpenDocument={onOpenDocument}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.section>
      )}
    </AnimatePresence>
  )
}

function TrayGlyph({ summary, offline }: { summary: TransferSummary; offline: boolean }) {
  const radius = 8
  const circumference = 2 * Math.PI * radius

  if (summary.isSettled) {
    const hasFailure = summary.failed > 0
    const hasHeld = !hasFailure && summary.held > 0
    return (
      <span
        aria-hidden
        data-testid="upload-tray-glyph"
        data-tone={hasFailure ? 'destructive' : hasHeld ? 'warning' : 'success'}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full',
          'animate-in zoom-in-75 fade-in-0 duration-base ease-entrance motion-reduce:animate-none',
          hasFailure
            ? 'bg-danger-subtle text-error'
            : hasHeld
              ? 'bg-warning-subtle text-warning'
              : 'bg-success-subtle text-success'
        )}
      >
        {hasFailure ? (
          <AlertCircle className="size-3.5" />
        ) : hasHeld ? (
          <ShieldAlert className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
      </span>
    )
  }

  if (offline) {
    return (
      <span
        aria-hidden
        data-testid="upload-tray-glyph"
        data-tone="offline"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning"
      >
        <WifiOff className="size-3.5" />
      </span>
    )
  }

  const determinate = summary.stage === 'transferring' && summary.bytesPercent !== null
  const filled = determinate ? (summary.bytesPercent! / 100) * circumference : circumference * 0.28

  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cn('size-5 shrink-0 -rotate-90', !determinate && 'animate-spin')}
    >
      <circle cx="10" cy="10" r={radius} fill="none" strokeWidth="2.5" className="stroke-foreground/12" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        className="stroke-primary transition-[stroke-dasharray] duration-deliberate ease-out motion-reduce:transition-none"
      />
    </svg>
  )
}

function TrackBar({
  percent,
  sweeping,
  className,
  testId,
}: {
  percent: number | null
  sweeping: boolean
  className?: string
  testId?: string
}) {
  if (percent === null && !sweeping) return null

  return (
    <div
      data-testid={testId}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': percent })}
      className={cn('relative h-[3px] w-full overflow-hidden bg-foreground/8', className)}
    >
      {percent === null ? (
        <span className="animate-progress-sweep block h-full w-1/3 rounded-full bg-primary/60 motion-reduce:animate-none" />
      ) : (
        <span
          className="block h-full w-full origin-left rounded-r-full bg-primary transition-transform duration-quick ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      )}
    </div>
  )
}

function UploadRow({
  file,
  onRetry,
  onCancel,
  onDismiss,
  onOpenDocument,
}: Pick<UploadTrayProps, 'onRetry' | 'onCancel' | 'onDismiss' | 'onOpenDocument'> & { file: TrackedFile }) {
  const t = useTranslations(filesCopy)
  const tc = useTranslations(commonCopy)
  const { locale } = useLocale()
  const landing = useMotionToken(iconSwapTransition)
  const fold = useMotionToken(motionBase)

  const phase = uploadPhase(file)
  const percent = uploadPercent(file)
  const mark = ingestionMarkOfPhase(phase)
  const canCancel = (phase === 'uploading' || phase === 'queued') && onCancel !== undefined
  const canStopReading = file.status === 'ingesting' && !!file.serverFileId && onCancel !== undefined
  const isFailed = phase === 'failed'
  const isHeldBack = phase === 'held'
  const reviewableId =
    file.serverFileId ?? (file.replacesHeld?.ownUpload ? file.replacesHeld.documentId : null) ?? null
  const heldVerdict = isHeldBack ? quarantineVerdictOf(file) : null
  const unchanged = file.unchanged === true && phase === 'ready'
  const canDismiss = (phase === 'canceled' || isFailed || isHeldBack) && onDismiss !== undefined
  const canRetry = isFailed && mayRetryUpload(file)
  const showsSizeInline = phase === 'uploading' || phase === 'queued'
  const lit = useFilingHighlighted(file.serverFileId)

  return (
    // eslint-disable-next-line grid/motion-vocabulary -- a dismissed row folds away so the rows below slide up instead of jumping; instant under reduced motion
    <motion.li
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={landing}
      data-testid="upload-row"
      data-phase={phase}
      className={cn('relative overflow-hidden border-t first:border-t-0', lit && HIGHLIGHT_OUTLINE_INSET)}
    >
      {/* One fixed-height line in every phase. The size, the status word and
          the actions each own a column of fixed width, so a row gaining or
          losing a button does not shove its neighbours sideways, and a German
          status word („Zurückgehalten“, „Fehlgeschlagen“) is never cut. */}
      <div className="flex h-12 items-center gap-2.5 px-4 sm:h-10">
        {/* The extension tile the Files list draws, so a document looks like
            itself from the second it is dropped. */}
        <FileExtChip filename={file.fileName} size="xs" fallback="—" />

        {/* On a phone the status word sits under the name, so the name keeps
            the width; from `sm` up they share the line in fixed columns. */}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2.5">
        <div className="flex min-w-0 items-center gap-2 sm:flex-1">
          {/* The name loses its middle, never its end: the revision and the
              extension are what tell two Fassungen of one drawing apart, and
              a phone shows about 25 characters of it. */}
          <p className="min-w-0 text-xs text-foreground" data-testid="upload-row-name">
            <MiddleTruncate text={file.fileName} tail={ROW_NAME_TAIL} />
          </p>
          {/* Where Piloti would file it, while the person is still at the
              upload: the chip, as on the card, on the row's one line. */}
          {!isFailed && !isHeldBack && (
            <FilingSuggestionSlot documentId={file.serverFileId} className="max-w-[60%] shrink-0" />
          )}
        </div>

        {/* Off on a phone: the name is what tells two rows apart, and the
            fixed columns beside it would leave it a few characters. */}
        <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
          {formatBytes(file.fileSize, locale)}
        </span>

        {/* Glyph, word and ink from one table (`ingestion-atoms`): waiting,
            sending, reading, filed and cancelled all write in muted ink, and
            the glyph is what tells them apart at a glance. No shimmer on a
            reading row: the header's sweep is the batch's one loop, and a
            shimmer per row made a batch of twelve twelve loops. */}
        <span
          className={cn(
            unchanged ? 'sm:min-w-28' : 'sm:w-28',
            'flex shrink-0 items-center text-xs font-medium tabular-nums sm:justify-end'
          )}
          data-testid={unchanged ? 'upload-row-unchanged' : undefined}
        >
          <IngestionStatusWord mark={mark} quiet={unchanged}>
            {unchanged ? t('uploads.row.unchanged') : phaseLabel(phase, percent, t)}
          </IngestionStatusWord>
          {/* The size column is off on a phone, so a file that is still moving
              carries its size here: „42 % · 4,8 MB" says how much is left. */}
          {showsSizeInline && (
            <span className="whitespace-pre font-normal text-muted-foreground sm:hidden"> · {formatBytes(file.fileSize, locale)}</span>
          )}
        </span>
        </div>

        {/* On a finger the row has ONE action. A failed row's retry is the
            labelled button under its reason (below), not a second icon beside
            the dismiss: two 44px icons in a 393px row left the name no room,
            and a bare arrow says less than „Erneut versuchen". */}
        <span className="flex w-[52px] shrink-0 items-center justify-end gap-1 pointer-coarse:w-11">
          {canRetry && (
            <RowAction
              label={tc('actions.retry')}
              onClick={() => onRetry(file.id)}
              icon={RotateCcw}
              className="pointer-coarse:hidden"
            />
          )}
          {(canCancel || canStopReading) && (
            <RowAction
              label={
                canStopReading
                  ? t('uploads.actions.stop', { name: file.fileName })
                  : t('uploads.actions.cancel', { name: file.fileName })
              }
              onClick={() => onCancel?.(file.id)}
              icon={canStopReading ? Ban : X}
            />
          )}
          {canDismiss && (
            <RowAction
              label={t('uploads.actions.dismiss', { name: file.fileName })}
              onClick={() => onDismiss?.([file.id])}
              icon={X}
            />
          )}
        </span>
      </div>

      {/* The bytes of THIS file, on the row's bottom edge rather than under it:
          a track that took its own line made every row taller while it sent
          and shorter when it finished, and the listing below jumped with each
          one. Only while bytes move; reading has no position, and the row says
          so with its word and the header's sweep. */}
      {isDeterminate(phase) && (
        <TrackBar percent={percent} sweeping={false} className="absolute inset-x-4 bottom-0 h-0.5 w-auto rounded-full" />
      )}

      <AnimatePresence initial={false}>
        {(isFailed && (file.errorMessage || canRetry)) || isHeldBack ? (
          // eslint-disable-next-line grid/motion-vocabulary -- the reason folds open under its own row when the file settles; instant under reduced motion
          <motion.div
            key="reason"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={fold}
            className="overflow-hidden"
          >
            <div className="-mt-1 pb-2 pl-[50px] pr-4">
              {/* A file the server accepted failed while being read: its
                  message is the stored ingest failure, said in the reader's
                  language. One that never arrived failed its upload, and that
                  message is a dictionary sentence already: `use-file-upload`
                  writes it through `uploadFailureSentence`, which never passes
                  the server's or the transport's English on. */}
              {isFailed && file.errorMessage && failedWhileReading(file) ? (
                <IngestFailureNotice
                  errorMessage={file.errorMessage}
                  sentenceClassName="leading-snug text-error"
                  testId="upload-row-failure"
                />
              ) : isFailed && file.errorMessage ? (
                <p className="text-xs leading-snug text-error">{file.errorMessage}</p>
              ) : null}

              {/* Only where there is no hover and no room for a bare icon. */}
              {canRetry && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2 hidden gap-1.5 pointer-coarse:inline-flex"
                  onClick={() => onRetry(file.id)}
                  data-testid="upload-row-retry"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('uploads.actions.retryFile')}
                </Button>
              )}

              {/* Why it was held, as the Files preview and the upload summary
                  say it. No page buttons: the tray cannot show the document.
                  The sentence that explains holding back stands in only when
                  there are no reasons to list. A row refused because the file
                  it replaces is held says that in its own sentence. */}
              {isHeldBack && (
                <HeldUploadReason
                  verdict={heldVerdict}
                  replacesHeld={file.replacesHeld}
                  message={file.errorMessage}
                  withoutSentence={(heldVerdict?.reasons.length ?? 0) > 0}
                  testId="upload-row-held"
                />
              )}
              {/* Allow it or ask for a review, where they first learn of it:
                  this upload, or the held file it would replace. */}
              {isHeldBack && reviewableId && (
                <HeldUploadDecision
                  documentId={reviewableId}
                  name={file.fileName}
                  onReleased={reviewableId === file.serverFileId ? () => readAllowedRowAgain(file.id) : undefined}
                  onView={onOpenDocument && (() => onOpenDocument(reviewableId))}
                  className="mt-2 h-7 px-2 text-xs"
                  askTestId="upload-row-request-review"
                  allowTestId="upload-row-allow"
                />
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  )
}

function RowAction({
  label,
  onClick,
  icon: Icon,
  className,
}: {
  label: string
  onClick: () => void
  icon: typeof X
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:size-11',
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  )
}

function phaseLabel(phase: UploadPhase, percent: number | null, t: ReturnType<typeof useTranslations>): string {
  switch (phase) {
    case 'uploading':
      return percent === null ? t('uploads.row.uploading') : `${percent}%`
    case 'queued':
      return t('uploads.row.queued')
    case 'processing':
      return t('uploads.row.processing')
    case 'ready':
      return t('uploads.row.ready')
    case 'held':
      return t('uploads.row.held')
    case 'stored':
      return t('uploads.row.stored')
    case 'canceled':
      return t('uploads.row.canceled')
    case 'failed':
      return t('uploads.row.failed')
  }
}

function trayHeadline(summary: TransferSummary, t: ReturnType<typeof useTranslations>): string {
  if (summary.stage === 'transferring') {
    const count = summary.queued + summary.uploading
    return t(count === 1 ? 'uploads.heading.transferringOne' : 'uploads.heading.transferringOther', { count })
  }
  if (summary.stage === 'processing') {
    return t(summary.processing === 1 ? 'uploads.heading.processingOne' : 'uploads.heading.processingOther', {
      count: summary.processing,
    })
  }
  const added = summary.ready + summary.stored
  if (added > 0 && summary.failed > 0) {
    return t('uploads.heading.mixed', { ready: added, failed: summary.failed })
  }
  if (summary.failed > 0) {
    return t(summary.failed === 1 ? 'uploads.heading.failedOne' : 'uploads.heading.failedOther', {
      count: summary.failed,
    })
  }
  if (added > 0 && summary.held > 0) {
    return t('uploads.heading.mixedHeld', { ready: added, held: summary.held })
  }
  if (summary.held > 0) {
    return t(summary.held === 1 ? 'uploads.heading.heldOne' : 'uploads.heading.heldOther', { count: summary.held })
  }
  if (added > 0) {
    return t(added === 1 ? 'uploads.heading.doneOne' : 'uploads.heading.doneOther', { count: added })
  }
  return t('uploads.heading.canceled')
}

function trayDetail(
  summary: TransferSummary,
  context: {
    bytesPerSecond: number | null
    etaSeconds: number | null
    processingElapsed: number
    locale: string
    t: ReturnType<typeof useTranslations>
  }
): string {
  const { bytesPerSecond, etaSeconds, processingElapsed, locale, t } = context

  if (summary.stage === 'transferring') {
    const parts = [t('uploads.detail.bytes', formatByteProgress(summary.uploadedBytes, summary.totalBytes, locale))]
    if (bytesPerSecond !== null) parts.push(formatTransferRate(bytesPerSecond, locale))
    if (etaSeconds !== null && etaSeconds > 0) {
      parts.push(t('uploads.detail.eta', { time: formatDurationShort(etaSeconds, locale) }))
    }
    if (summary.queued > 0) parts.push(t('uploads.detail.queued', { count: summary.queued }))
    return parts.join(' · ')
  }

  if (summary.stage === 'processing') {
    const parts = [t('uploads.detail.processing')]
    if (processingElapsed >= 5) {
      parts.push(t('uploads.detail.elapsed', { time: formatDurationShort(processingElapsed, locale) }))
    }
    return parts.join(' · ')
  }

  return t('uploads.detail.settled', { total: formatBytes(summary.uploadedBytes, locale) })
}
