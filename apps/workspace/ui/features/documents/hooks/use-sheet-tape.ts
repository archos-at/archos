'use client'

// The tape on a PDF drawing: points snap in the browser from the page's snap targets, a live length is provisional,
// and only the engine's measurement (asked when the shape is finished) becomes the reading the draft card keeps.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MeasureShape, PagePoint } from '@/lib/annotations/measure-shapes'
import { measureOnSheet, TapeRequestError } from '@/lib/drawing-tape/client'
import type {
  MeasureRequest,
  MeasureResponse,
  TapeMeasurement,
  TapeNoNumber,
} from '@/lib/drawing-tape/wire'
import { fetchSnapTargets, type SnapTargets } from '@/lib/drawing-tape/snap-wire'
import {
  buildSnapIndex,
  provisionalArea,
  provisionalLength,
  snapPoint,
  type SnapIndex,
  type SnapKind,
} from '../lib/sheet-snap'

export const TAPE_MODES = ['distance', 'path', 'area'] as const
export type TapeMode = (typeof TAPE_MODES)[number]
export const TAPE_SHAPE: Record<TapeMode, MeasureShape> = {
  distance: 'line',
  path: 'path',
  area: 'polygon',
}
const FEWEST: Record<TapeMode, number> = { distance: 2, path: 2, area: 3 }
const SNAP_RADIUS_PX = 12
const CLOSE_RADIUS_PX = 10

export type TapePhase = 'placing' | 'measuring' | 'measured' | 'refused' | 'failed'
export interface TapeHover {
  page: number
  at: PagePoint
  kind: SnapKind
}
export interface PageSize {
  width: number
  height: number
}
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
export type TapeTargets = (documentId: string, page: number) => Promise<SnapTargets>

export interface SheetTape {
  available: boolean
  active: boolean
  mode: TapeMode
  setMode: (mode: TapeMode) => void
  page: number | null
  points: PagePoint[]
  kinds: SnapKind[]
  hover: TapeHover | null
  phase: TapePhase
  reading: TapeMeasurement | null
  refusal: TapeNoNumber | null
  provisional: { value: number; unit: 'm' | 'm2' } | null
  canFinish: boolean
  scaleOf: (page: number) => SnapTargets['scales'] | null
  unscaled: (page: number) => boolean
  refresh: () => void
  again: (place: Pick<TapePlace, 'page' | 'shape' | 'points'>) => void
  load: (page: number) => void
  pointer: (page: number, raw: PagePoint | null, size: PageSize) => void
  add: (page: number, raw: PagePoint, size: PageSize) => void
  undo: () => void
  finish: () => void
  clear: () => void
}

const EMPTY = { page: null as number | null, points: [] as PagePoint[], kinds: [] as SnapKind[] }

export const IDLE_TAPE: SheetTape = {
  available: false,
  active: false,
  mode: 'distance',
  setMode: () => undefined,
  page: null,
  points: [],
  kinds: [],
  hover: null,
  phase: 'placing',
  reading: null,
  refusal: null,
  provisional: null,
  canFinish: false,
  scaleOf: () => null,
  unscaled: () => false,
  refresh: () => {},
  again: () => undefined,
  load: () => undefined,
  pointer: () => undefined,
  add: () => undefined,
  undo: () => undefined,
  finish: () => undefined,
  clear: () => undefined,
}

const near = (a: PagePoint, b: PagePoint, size: PageSize, px: number) =>
  Math.hypot((a[0] - b[0]) * size.width, (a[1] - b[1]) * size.height) <= px

export function useSheetTape({
  documentId,
  available,
  active,
  draftOpen,
  placeDraft,
  measure = measureOnSheet,
  targets = fetchSnapTargets,
}: {
  documentId: string
  available: boolean
  active: boolean
  draftOpen: boolean
  placeDraft: (place: TapePlace | null) => void
  measure?: TapeMeasure
  targets?: TapeTargets
}): SheetTape {
  const [mode, setModeState] = useState<TapeMode>('distance')
  const [shape, setShape] = useState(EMPTY)
  const [hover, setHover] = useState<TapeHover | null>(null)
  const [phase, setPhase] = useState<TapePhase>('placing')
  const [answer, setAnswer] = useState<{
    reading: TapeMeasurement | null
    refusal: TapeNoNumber | null
  }>({ reading: null, refusal: null })
  const [loaded, setLoaded] = useState<
    ReadonlyMap<number, { targets: SnapTargets; index: SnapIndex }>
  >(new Map())
  const asked = useRef(new Set<number>())
  const ticket = useRef(0)
  const offered = available

  const clear = useCallback(() => {
    ticket.current += 1
    setShape(EMPTY)
    setHover(null)
    setPhase('placing')
    setAnswer({ reading: null, refusal: null })
  }, [])

  useEffect(() => {
    asked.current = new Set()
    setLoaded(new Map())
    clear()
  }, [documentId, clear])
  useEffect(() => {
    if (!active) clear()
  }, [active, clear])

  const load = useCallback(
    (page: number) => {
      if (asked.current.has(page)) return
      asked.current.add(page)
      targets(documentId, page)
        .then((found) =>
          setLoaded((current) =>
            new Map(current).set(page, { targets: found, index: buildSnapIndex(found) })
          )
        )
        .catch(() => asked.current.delete(page))
    },
    [documentId, targets]
  )

  const refresh = useCallback(() => {
    const pages = [...asked.current]
    asked.current = new Set()
    pages.forEach(load)
  }, [load])

  const snap = useCallback(
    (page: number, raw: PagePoint, size: PageSize): { at: PagePoint; kind: SnapKind } => {
      const here = loaded.get(page)
      if (!here) {
        load(page)
        return { at: raw, kind: 'free' }
      }
      return snapPoint(here.index, raw, size, SNAP_RADIUS_PX) ?? { at: raw, kind: 'free' }
    },
    [loaded, load]
  )

  const settled = phase !== 'placing'
  const hadDraft = useRef(false)
  useEffect(() => {
    if (hadDraft.current && !draftOpen && settled) clear()
    hadDraft.current = draftOpen
  }, [draftOpen, settled, clear])
  const pointer = useCallback(
    (page: number, raw: PagePoint | null, size: PageSize) => {
      if (!active || !raw || settled) {
        setHover(null)
        if (raw) load(page)
        return
      }
      const found = snap(page, raw, size)
      setHover({ page, at: found.at, kind: found.kind })
    },
    [active, settled, snap, load]
  )

  const run = useCallback(
    async (page: number, points: PagePoint[], current: TapeMode) => {
      const mine = ++ticket.current
      setPhase('measuring')
      setHover(null)
      try {
        const result = await measure(documentId, { page, operation: current, points })
        if (ticket.current !== mine) return
        if ('measurement' in result) {
          setAnswer({ reading: result.measurement, refusal: null })
          setPhase('measured')
          const [first] = points
          placeDraft({
            page,
            shape: TAPE_SHAPE[current],
            x: first[0],
            y: first[1],
            w: null,
            h: null,
            points,
          })
        } else if ('noNumber' in result) {
          setAnswer({ reading: null, refusal: result.noNumber })
          setPhase('refused')
        } else setPhase('failed')
      } catch (error) {
        if (ticket.current !== mine) return
        setAnswer({ reading: null, refusal: null })
        setPhase(error instanceof TapeRequestError && error.status === 422 ? 'refused' : 'failed')
      }
    },
    [documentId, measure, placeDraft]
  )

  const add = useCallback(
    (page: number, raw: PagePoint, size: PageSize) => {
      if (!active || phase === 'measuring' || loaded.get(page)?.targets.scales.length === 0) return
      const fresh = settled || shape.page !== page
      if (fresh && settled) placeDraft(null)
      const before = fresh ? EMPTY : shape
      const found = snap(page, raw, size)
      const [first] = before.points
      if (
        mode === 'area' &&
        first &&
        before.points.length >= FEWEST.area &&
        near(found.at, first, size, CLOSE_RADIUS_PX)
      ) {
        void run(page, before.points, mode)
        return
      }
      const last = before.points[before.points.length - 1]
      if (last && near(found.at, last, size, 3)) return
      const points = [...before.points, found.at]
      setShape({ page, points, kinds: [...before.kinds, found.kind] })
      setPhase('placing')
      setAnswer({ reading: null, refusal: null })
      if (mode === 'distance' && points.length === 2) void run(page, points, mode)
    },
    [active, phase, settled, shape, snap, mode, run, placeDraft, loaded]
  )

  const canFinish =
    active && phase === 'placing' && shape.page !== null && shape.points.length >= FEWEST[mode]
  const finish = useCallback(() => {
    if (canFinish && shape.page !== null) void run(shape.page, shape.points, mode)
  }, [canFinish, shape, mode, run])

  const undo = useCallback(() => {
    if (settled) {
      placeDraft(null)
      clear()
      return
    }
    setShape((current) =>
      current.points.length <= 1
        ? EMPTY
        : { ...current, points: current.points.slice(0, -1), kinds: current.kinds.slice(0, -1) }
    )
  }, [settled, placeDraft, clear])

  const setMode = useCallback(
    (next: TapeMode) => {
      if (settled) placeDraft(null)
      clear()
      setModeState(next)
    },
    [settled, placeDraft, clear]
  )

  const scaleOf = useCallback((page: number) => loaded.get(page)?.targets.scales ?? null, [loaded])
  const unscaled = useCallback(
    (page: number) => loaded.get(page)?.targets.scales.length === 0,
    [loaded]
  )
  const again = useCallback(
    ({ page, shape: kept, points }: Pick<TapePlace, 'page' | 'shape' | 'points'>) => {
      const next = TAPE_MODES.find((candidate) => TAPE_SHAPE[candidate] === kept) ?? 'distance'
      setModeState(next)
      setShape({ page, points, kinds: points.map((): SnapKind => 'free') })
      void run(page, points, next)
    },
    [run]
  )
  const provisional = useMemo(() => {
    if (shape.page === null || settled) return null
    const scales = loaded.get(shape.page)?.targets.scales
    if (!scales) return null
    const trail = hover && hover.page === shape.page ? [...shape.points, hover.at] : shape.points
    if (mode === 'area') {
      const value = trail.length >= 3 ? provisionalArea(trail, scales) : null
      return value === null ? null : { value, unit: 'm2' as const }
    }
    const value = trail.length >= 2 ? provisionalLength(trail, scales) : null
    return value === null ? null : { value, unit: 'm' as const }
  }, [shape, settled, loaded, hover, mode])

  return useMemo(
    () => ({
      available: offered,
      active: active && offered,
      mode,
      setMode,
      page: shape.page,
      points: shape.points,
      kinds: shape.kinds,
      hover,
      phase,
      reading: answer.reading,
      refusal: answer.refusal,
      provisional,
      canFinish,
      scaleOf,
      unscaled,
      refresh,
      again,
      load,
      pointer,
      add,
      undo,
      finish,
      clear,
    }),
    [
      offered,
      active,
      mode,
      setMode,
      shape,
      hover,
      phase,
      answer,
      provisional,
      canFinish,
      scaleOf,
      unscaled,
      refresh,
      again,
      load,
      pointer,
      add,
      undo,
      finish,
      clear,
    ]
  )
}
