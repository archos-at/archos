'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FileX2, Lock } from 'lucide-react'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSheet } from '@/features/knowledge/page-clip'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { calibrationRatio } from '@/lib/drawing-calibrations/display-ratio'
import { CALIBRATION_SET_OPERATION } from '@/lib/drawing-calibrations/operation'
import { formatMetres } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useServerProposal } from '../hooks/use-server-proposal'
import { drawCalibrationClip, type ClipPoint, type DrawnClip } from '../lib/calibration-clip'
import { CLIP_ASPECT, proposedCalibrationOf, type ProposedCalibration } from '../lib/calibration-proposal'
import { ProposalReceipt } from './ProposalReceipt'
import { FailureReasons } from './ProposalReceipts'

const FALLBACK_WIDTH = 320
const MAX_CLIP_HEIGHT = 380
export const CLIP_TIMEOUT_MS = 20_000
const LABEL_OFFSET_PX = 13
const MARKER_RADIUS = 4

type Clip = { status: 'waiting' } | DrawnClip
type Refusal = 'denied' | 'unavailable' | 'incomplete'
type Drawn = Extract<DrawnClip, { status: 'drawn' }>
type Place = { document: string | null; page: number }

const percent = (share: number): string => `${share * 100}%`

export function CalibrationReceipt({
  proposalId,
  input,
}: {
  proposalId: string
  input: Record<string, unknown>
}) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const server = useServerProposal(proposalId, 'operation')
  const { proposal } = server
  const shownInput = proposal?.payload.input ?? input
  const proposed = useMemo(
    () => proposedCalibrationOf(CALIBRATION_SET_OPERATION, shownInput),
    [shownInput]
  )
  const target = proposal?.targets?.find(
    (entry) => entry.type === 'document' && entry.id === proposed?.documentId
  )
  const documentName = target?.name ?? null
  const [clip, setClip] = useState<Clip>({ status: 'waiting' })
  const reading = !proposal && server.problem === null
  const refusal: Refusal | null = !proposed
    ? 'incomplete'
    : target && target.name === null
      ? 'denied'
      : clip.status === 'denied' || clip.status === 'unavailable'
        ? clip.status
        : null
  const ratio =
    proposed && clip.status === 'drawn' ? calibrationRatio(proposed.calibration, clip.pagePt) : null

  const placeText = (page: number) =>
    documentName
      ? t('cards.calibrationProposal.caption', { document: documentName, page })
      : t('cards.calibrationProposal.captionPage', { page })

  return (
    <ProposalReceipt
      server={server}
      eyebrow={
        <SectionLabel className="max-sm:hidden">
          {t('cards.calibrationProposal.eyebrow')}
        </SectionLabel>
      }
      open={
        reading ? null : proposed && !refusal ? (
          <CalibrationQuestion
            proposed={proposed}
            place={{ document: documentName, page: proposed.calibration.page }}
            ratio={ratio}
            clip={clip}
            onClip={setClip}
          />
        ) : (
          <CalibrationRefusal
            reason={refusal ?? 'incomplete'}
            place={proposed ? { document: documentName, page: proposed.calibration.page } : null}
          />
        )
      }
      accept={
        refusal
          ? null
          : {
              label: t('cards.calibrationProposal.accept'),
              working: t('cards.calibrationProposal.accepting'),
            }
      }
      prompt={null}
      footnote={refusal ? undefined : t('cards.calibrationProposal.dismissMeaning')}
      acceptBlocked={
        !refusal && clip.status === 'waiting' ? t('cards.calibrationProposal.waiting') : undefined
      }
      headline={(decided) => {
        switch (decided.status) {
          case 'applied':
          case 'partially_applied':
            return ratio
              ? t('cards.calibrationProposal.appliedRatio', { ratio })
              : t('cards.calibrationProposal.applied')
          case 'failed':
            return t('cards.proposalReceipt.failed')
          default:
            return t('cards.calibrationProposal.dismissed')
        }
      }}
      decidedBody={(decided) =>
        decided.status === 'failed' || !proposed ? (
          <FailureReasons results={decided.results} />
        ) : (
          <p className="text-meta text-muted-foreground" data-testid="calibration-receipt">
            {t('cards.calibrationProposal.receipt', {
              length: formatMetres(proposed.calibration.lengthM, locale),
              place: placeText(proposed.calibration.page),
            })}
          </p>
        )
      }
    />
  )
}

function PlaceCaption({ place }: { place: Place }) {
  const t = useTranslations(chatCopy)
  const pageText = t(
    place.document ? 'cards.calibrationProposal.captionTail' : 'cards.calibrationProposal.captionPage',
    { page: place.page }
  )
  return (
    <p
      className="text-meta text-muted-foreground flex min-w-0 whitespace-pre"
      data-testid="calibration-caption"
    >
      {place.document ? (
        <>
          <MiddleTruncate text={place.document} />
          <span className="shrink-0">{` · ${pageText}`}</span>
        </>
      ) : (
        pageText
      )}
    </p>
  )
}

function CalibrationRefusal({ reason, place }: { reason: Refusal; place: Place | null }) {
  const t = useTranslations(chatCopy)
  const Icon = reason === 'denied' ? Lock : FileX2
  return (
    <div className="flex flex-col gap-2" data-testid="calibration-refusal" data-reason={reason}>
      <div className="bg-muted/60 text-foreground rounded-inline flex items-start gap-2 p-3 text-sm">
        <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p>{t(`cards.calibrationProposal.refused.${reason}`)}</p>
      </div>
      {place && <PlaceCaption place={place} />}
    </div>
  )
}

function CalibrationQuestion({
  proposed,
  place,
  ratio,
  clip,
  onClip,
}: {
  proposed: ProposedCalibration
  place: Place
  ratio: string | null
  clip: Clip
  onClip: (clip: Clip) => void
}) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const length = formatMetres(proposed.calibration.lengthM, locale)
  return (
    <figure className="flex flex-col gap-3" data-testid="calibration-preview">
      <CalibrationClip proposed={proposed} clip={clip} onClip={onClip} length={length} />
      <figcaption className="flex min-w-0 flex-col gap-1">
        <p className="text-section text-foreground" data-testid="calibration-question">
          {t('cards.calibrationProposal.question', { length })}
        </p>
        {ratio && (
          <p className="text-foreground text-sm" data-testid="calibration-meaning">
            {t('cards.calibrationProposal.meaning', { ratio })}
          </p>
        )}
        <PlaceCaption place={place} />
      </figcaption>
    </figure>
  )
}

function CalibrationClip({
  proposed,
  clip,
  onClip,
  length,
}: {
  proposed: ProposedCalibration
  clip: Clip
  onClip: (clip: Clip) => void
  length: string
}) {
  const t = useTranslations(chatCopy)
  const [seenRef, seen] = useSeenOnce<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const told = useRef(onClip)
  told.current = onClip
  const { documentId, calibration } = proposed
  const key = `${documentId}|${calibration.page}|${calibration.from.x},${calibration.from.y}|${calibration.to.x},${calibration.to.y}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!seen || !canvas) return
    const controller = new AbortController()
    told.current({ status: 'waiting' })
    const timer = window.setTimeout(() => {
      controller.abort()
      told.current({ status: 'unavailable' })
    }, CLIP_TIMEOUT_MS)
    void drawCalibrationClip({
      proposed,
      canvas,
      fit: { width: frameRef.current?.clientWidth || FALLBACK_WIDTH, maxHeight: MAX_CLIP_HEIGHT },
      signal: controller.signal,
    }).then((drawn) => {
      window.clearTimeout(timer)
      if (!controller.signal.aborted) told.current(drawn)
    })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, key])

  const drawn = clip.status === 'drawn' ? clip : null
  const setFrame = (node: HTMLDivElement | null): void => {
    frameRef.current = node
    seenRef(node)
  }
  return (
    <div ref={setFrame} className="flex w-full justify-center" data-state={clip.status}>
      <PageSheet
        className="rounded-inline max-w-full overflow-hidden"
        style={{
          aspectRatio: drawn ? drawn.aspect : CLIP_ASPECT,
          width: drawn ? drawn.width : '100%',
          maxHeight: drawn ? undefined : MAX_CLIP_HEIGHT,
        }}
      >
        <canvas
          ref={canvasRef}
          role={drawn ? 'img' : undefined}
          aria-label={
            drawn ? t('cards.calibrationProposal.picture', { page: calibration.page }) : undefined
          }
          aria-hidden={drawn ? undefined : true}
          className={cn('block h-full w-full', !drawn && 'invisible absolute inset-0')}
        />
        {drawn ? (
          <SpanMark drawn={drawn} length={length} />
        ) : (
          <Skeleton
            role="status"
            className="absolute inset-0 rounded-none"
            aria-label={t('cards.calibrationProposal.drawing')}
          />
        )}
      </PageSheet>
    </div>
  )
}

function labelOffset({ from, to, width, aspect }: Drawn): { x: number; y: number } {
  const dx = (to.x - from.x) * width
  const dy = (to.y - from.y) * (width / aspect)
  const norm = Math.hypot(dx, dy) || 1
  let x = -dy / norm
  let y = dx / norm
  if (y < -1e-9 || (Math.abs(y) <= 1e-9 && x < 0)) {
    x = -x
    y = -y
  }
  return { x: x * LABEL_OFFSET_PX, y: y * LABEL_OFFSET_PX }
}

const SQUARE = `M ${-MARKER_RADIUS} ${-MARKER_RADIUS} H ${MARKER_RADIUS} V ${MARKER_RADIUS} H ${-MARKER_RADIUS} Z`

function SpanMark({ drawn, length }: { drawn: Drawn; length: string }) {
  const { from, to } = drawn
  const offset = labelOffset(drawn)
  const line = { x1: percent(from.x), y1: percent(from.y), x2: percent(to.x), y2: percent(to.y) }
  const label: CSSProperties = {
    left: percent((from.x + to.x) / 2),
    top: percent((from.y + to.y) / 2),
    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
  }
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <line {...line} stroke="var(--paper-ink-foreground)" strokeWidth={4} strokeLinecap="round" />
        <line
          {...line}
          stroke="var(--paper-ink)"
          strokeWidth={1.5}
          strokeLinecap="round"
          data-testid="calibration-span"
        />
        {[from, to].map((end: ClipPoint, index) => (
          <svg
            key={index}
            x={percent(end.x)}
            y={percent(end.y)}
            overflow="visible"
            data-testid="calibration-end"
          >
            <path
              d={SQUARE}
              fill="var(--paper-ink-foreground)"
              stroke="var(--paper-ink)"
              strokeWidth={1.5}
            />
          </svg>
        ))}
      </svg>
      <span
        aria-hidden
        className="bg-sheet text-foreground text-meta pointer-events-none absolute rounded-full px-1.5 font-medium whitespace-nowrap tabular-nums shadow-xs"
        style={label}
      >
        {length}
      </span>
    </>
  )
}
