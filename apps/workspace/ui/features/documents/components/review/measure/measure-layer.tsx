'use client'

import type { JSX } from 'react'
import { FloatingNote } from '@/components/ui/floating-toolbar'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isLive, type AnnotationView } from '@/lib/annotations/types'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { TAPE_SHAPE } from '../../../hooks/use-sheet-tape'
import { pointIn } from '../page-point'
import { MeasureReadingCard } from './measure-reading'
import {
  middleOf,
  SheetAnchor,
  SheetCandidate,
  SheetClickSurface,
  SheetDot,
  SheetShape,
  SheetValueTag,
} from './sheet-shape'
import { formatReading } from './tape-format'

/** What the layer reads of the review: the marks, which one is open, and the tape. */
export type MeasureLayerReview = Pick<DocumentReview, 'annotations' | 'selectedId' | 'select' | 'tape'>

/** A kept measurement on its page: the shape through its points, its value at the middle, its reading when open. */
function KeptMeasurement({
  annotation,
  selected,
  onSelect,
}: {
  annotation: AnnotationView
  selected: boolean
  onSelect: () => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const points = annotation.points ?? []
  const reading = annotation.measurement
  const last = points[points.length - 1]
  if (!last) return null
  const value = reading ? formatReading(reading.value, reading.unit, locale) : null
  return (
    <>
      <SheetShape
        points={points}
        closed={annotation.shape === 'polygon'}
        kept
        selected={selected}
        data-testid={`measure-kept-${annotation.id}`}
      />
      {points.map((point, index) => (
        <SheetDot key={index} at={point} />
      ))}
      {value && (
        <SheetValueTag
          at={middleOf(points)}
          selected={selected}
          onClick={onSelect}
          aria-label={t('review.measure.kept', { number: annotation.number, value })}
          data-testid={`measure-kept-value-${annotation.id}`}
        >
          {value}
        </SheetValueTag>
      )}
      {selected && reading && (
        <SheetAnchor at={last}>
          <MeasureReadingCard reading={reading} />
        </SheetAnchor>
      )}
    </>
  )
}

/**
 * The tape on one page of the sheet (ADR-0182, slice 8): the measurements kept
 * on it, and, while a tape tool is in hand, the surface that takes its clicks,
 * the shape being placed and the engine's reading beside it.
 *
 * Every number shown is the engine's. A click is sent to be snapped; the point
 * drawn is where the engine tied it. A click it tied nowhere says why where the
 * click was, with the corners in reach to pick from.
 */
export function MeasureLayer({
  review,
  page,
  focused = true,
}: {
  review: MeasureLayerReview
  page: number
  /** The review is the one in front: only it takes the tape's clicks. */
  focused?: boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { annotations, selectedId, select, tape } = review
  const kept = annotations.filter(
    (annotation) =>
      annotation.page === page &&
      (annotation.points?.length ?? 0) >= 2 &&
      annotation.onCurrentRevision &&
      (isLive(annotation) || annotation.id === selectedId)
  )
  const active = focused && tape.tool !== null
  if (!active && kept.length === 0) return null
  const here = active && tape.page === page
  const miss = active && tape.miss?.page === page ? tape.miss : null
  const last = here ? tape.points[tape.points.length - 1] : undefined
  return (
    <div className="pointer-events-none absolute inset-0" data-testid={`measure-layer-${page}`}>
      {active && (
        <SheetClickSurface
          data-testid={`measure-capture-${page}`}
          onClick={(event) => {
            const point = pointIn(event.currentTarget, event)
            if (point) void tape.click(page, [point.x, point.y])
          }}
        />
      )}
      {kept.map((annotation) => (
        <KeptMeasurement
          key={annotation.id}
          annotation={annotation}
          selected={annotation.id === selectedId}
          onSelect={() => select(annotation.id === selectedId ? null : annotation.id)}
        />
      ))}
      {here && tape.tool && (
        <>
          <SheetShape points={tape.points} closed={TAPE_SHAPE[tape.tool] === 'polygon'} data-testid="measure-in-hand" />
          {tape.points.map((point, index) => (
            <SheetDot key={index} at={point} data-testid="measure-point" />
          ))}
        </>
      )}
      {miss && (
        <>
          {miss.candidates.map((candidate, index) => (
            <SheetCandidate
              key={index}
              at={candidate}
              aria-label={t('review.measure.candidate', { number: index + 1 })}
              data-testid="measure-candidate"
              onClick={() => void tape.click(page, candidate)}
            />
          ))}
          <SheetAnchor at={miss.at}>
            <FloatingNote role="status" className="w-max max-w-[16rem]" data-testid="measure-miss" data-reason={miss.reason}>
              {t(`review.measure.miss.${miss.reason}`)}
            </FloatingNote>
          </SheetAnchor>
        </>
      )}
      {last && !miss && (
        <SheetAnchor at={last}>
          <MeasureReadingCard
            reading={tape.reading}
            refusal={tape.refusal}
            busy={tape.busy}
            failed={tape.failed}
            onKeep={() => void tape.keep(t(`review.measure.keptBody.${tape.tool ?? 'distance'}`))}
            onDiscard={tape.clear}
          />
        </SheetAnchor>
      )}
    </div>
  )
}
