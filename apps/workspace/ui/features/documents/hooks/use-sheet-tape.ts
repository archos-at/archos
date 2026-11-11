'use client'

/**
 * The person's tape on a PDF drawing (ADR-0182, slice 8): a distance, a path or
 * an area between points clicked on a page, each tied to the linework by the
 * engine, and the engine's reading beside the shape.
 *
 * Nothing here computes a length. A click asks the route where the engine
 * snaps the point (`operation: 'snap'`); a point it ties nowhere is not taken,
 * and the reason (none in reach, or several with their places) is shown where
 * the click was, so the person can pick one. Once the shape has its points the
 * route measures them, and what comes back (the value with its interval and
 * provenance, or no number with the reason and remedy) is shown as it is.
 * "Keep" sets the shape as a mark; the server measures again and stores its
 * own answer, so the number kept is never this tab's.
 *
 * One tape per review (`useDocumentReview` holds it). It is put down when a
 * review tool is taken up, and takes the review's tool out of the hand when it
 * is taken up itself: one tool in hand at a time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MeasureShape, PagePoint } from '@/lib/annotations/measure-shapes'
import { measureOnDocument } from '@/lib/drawing-tape/client'
import type { MeasureRequest, MeasureResponse, TapeMeasurement, TapeNoNumber } from '@/lib/drawing-tape/wire'

export const TAPE_TOOLS = ['distance', 'path', 'area'] as const
export type TapeTool = (typeof TAPE_TOOLS)[number]

/** The mark's shape each tool keeps, and the fewest points it measures from. */
export const TAPE_SHAPE: Record<TapeTool, MeasureShape> = { distance: 'line', path: 'path', area: 'polygon' }
const FEWEST: Record<TapeTool, number> = { distance: 2, path: 2, area: 3 }

/** A click the engine tied nowhere: where it was, why, and the places it could be put on. */
export interface TapeMiss {
  page: number
  at: PagePoint
  reason: 'none' | 'several'
  candidates: PagePoint[]
}

/** A measurement to keep as a mark: the shape with its points, placed at the first. */
export interface TapePlace {
  page: number
  shape: MeasureShape
  x: number
  y: number
  w: null
  h: null
  points: PagePoint[]
}

export type TapeMeasure = (documentId: string, body: MeasureRequest) => Promise<MeasureResponse>

export interface SheetTape {
  /** The organization holds the tape and the document is a PDF: the tools are offered. */
  available: boolean
  tool: TapeTool | null
  /** The page the shape in hand is on; null until the first point. */
  page: number | null
  /** The points as the engine tied them, in order. */
  points: PagePoint[]
  miss: TapeMiss | null
  reading: TapeMeasurement | null
  refusal: TapeNoNumber | null
  /** A request is out: a snap, a measurement or the keep. */
  busy: boolean
  /** The last request failed (the route refused or could not be reached). */
  failed: boolean
  take: (tool: TapeTool | null) => void
  click: (page: number, at: PagePoint) => Promise<void>
  keep: (body: string) => Promise<void>
  clear: () => void
}

const NOTHING = { page: null as number | null, points: [] as PagePoint[] }

/** A tape nobody holds and nobody is offered: what a review without the tape carries (a spec's review, a preview). */
export const IDLE_TAPE: SheetTape = {
  available: false,
  tool: null,
  page: null,
  points: [],
  miss: null,
  reading: null,
  refusal: null,
  busy: false,
  failed: false,
  take: () => undefined,
  click: async () => undefined,
  keep: async () => undefined,
  clear: () => undefined,
}

export function useSheetTape({
  documentId,
  available,
  reviewTool,
  setReviewTool,
  keepMark,
  measure = measureOnDocument,
}: {
  documentId: string
  available: boolean
  /** The review's own tool in hand: anything but `select` puts the tape down. */
  reviewTool: string
  setReviewTool: (tool: 'select') => void
  /** Set the measurement as a mark (the review's `create`); resolves once it is kept. */
  keepMark: (body: string, place: TapePlace) => Promise<unknown>
  measure?: TapeMeasure
}): SheetTape {
  const [tool, setTool] = useState<TapeTool | null>(null)
  const [shape, setShape] = useState(NOTHING)
  const [miss, setMiss] = useState<TapeMiss | null>(null)
  const [answer, setAnswer] = useState<{ reading: TapeMeasurement | null; refusal: TapeNoNumber | null }>({
    reading: null,
    refusal: null,
  })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Each request takes a ticket; an answer whose ticket is no longer the newest is dropped.
  const ticket = useRef(0)

  const clear = useCallback(() => {
    ticket.current += 1
    setShape(NOTHING)
    setMiss(null)
    setAnswer({ reading: null, refusal: null })
    setBusy(false)
    setFailed(false)
  }, [])

  const take = useCallback(
    (next: TapeTool | null) => {
      clear()
      setTool(available ? next : null)
      if (next) setReviewTool('select')
    },
    [available, clear, setReviewTool]
  )

  // A review tool taken up, another document, or the tape withdrawn: the tape is put down.
  useEffect(() => {
    if (reviewTool !== 'select' || !available) {
      setTool(null)
      clear()
    }
  }, [reviewTool, available, clear])
  useEffect(() => {
    setTool(null)
    clear()
  }, [documentId, clear])

  // Escape steps back one thing: the shape in hand, then the tool. Taken before the review's own Escape, which
  // would otherwise close the review under a tape still in hand.
  const placed = shape.points.length > 0 || miss !== null
  useEffect(() => {
    if (!tool) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (placed) clear()
      else setTool(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [tool, placed, clear])

  /** Ask the route, and hand the answer on only while it is still the newest request. */
  const ask = useCallback(
    async (body: MeasureRequest): Promise<MeasureResponse | null> => {
      const mine = ++ticket.current
      setBusy(true)
      setFailed(false)
      try {
        const result = await measure(documentId, body)
        return ticket.current === mine ? result : null
      } catch {
        if (ticket.current === mine) setFailed(true)
        return null
      } finally {
        if (ticket.current === mine) setBusy(false)
      }
    },
    [documentId, measure]
  )

  const click = useCallback(
    async (page: number, at: PagePoint) => {
      if (!tool) return
      // A shape is on one page; a click on another page, or after a finished distance, starts a new one.
      const fresh = shape.page !== page || (tool === 'distance' && shape.points.length >= 2)
      const before = fresh ? [] : shape.points
      setMiss(null)
      const snapped = await ask({ page, operation: 'snap', points: [at] })
      const found = snapped && 'snap' in snapped ? snapped.snap[0] : null
      if (!found) return
      if (!found.snapped) {
        setMiss({ page, at, reason: found.reason ?? 'none', candidates: found.candidates })
        return
      }
      const points = [...before, found.snapped]
      setShape({ page, points })
      setAnswer({ reading: null, refusal: null })
      if (points.length < FEWEST[tool]) return
      const measured = await ask({ page, operation: tool, points })
      if (!measured) return
      setAnswer({
        reading: 'measurement' in measured ? measured.measurement : null,
        refusal: 'noNumber' in measured ? measured.noNumber : null,
      })
    },
    [ask, shape, tool]
  )

  const keep = useCallback(
    async (body: string) => {
      const [first] = shape.points
      if (!tool || shape.page === null || !first || !answer.reading) return
      const mine = ++ticket.current
      setBusy(true)
      setFailed(false)
      try {
        await keepMark(body, {
          page: shape.page,
          shape: TAPE_SHAPE[tool],
          x: first[0],
          y: first[1],
          w: null,
          h: null,
          points: shape.points,
        })
        setTool(null)
        clear()
      } catch {
        if (ticket.current === mine) {
          setFailed(true)
          setBusy(false)
        }
      }
    },
    [answer.reading, clear, keepMark, shape, tool]
  )

  return useMemo(
    () => ({
      available,
      tool,
      page: shape.page,
      points: shape.points,
      miss,
      reading: answer.reading,
      refusal: answer.refusal,
      busy,
      failed,
      take,
      click,
      keep,
      clear,
    }),
    [available, tool, shape, miss, answer, busy, failed, take, click, keep, clear]
  )
}
