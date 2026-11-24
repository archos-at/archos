import type { PagePlace } from '@/features/knowledge/page-clip'
import type { Translator } from '@/i18n'
import type { StoredMeasure } from '@/lib/conversations/message-measure'
import type { StoredAction } from '@/lib/conversations/message-provenance'
import { firstPage } from './work-sentence'

type Box = readonly [number, number, number, number]
export type Point = readonly [number, number]

export interface MeasureStepPlace {
  place: PagePlace
  shape: StoredMeasure
  box: Box
}

const MIN_SPAN = 0.02

const clampSpan = (low: number, high: number): [number, number] => {
  const pad = Math.max(0, (MIN_SPAN - (high - low)) / 2)
  const start = Math.min(Math.max(0, low - pad), 1 - Math.max(MIN_SPAN, high - low))
  return [start, Math.min(1, start + Math.max(MIN_SPAN, high - low))]
}

const PAD_SHARE = 0.15
const MIN_PAD = 0.004

const padSpan = ([low, high]: [number, number]): [number, number] => {
  const pad = Math.max(MIN_PAD, (high - low) * PAD_SHARE)
  return [Math.max(0, low - pad), Math.min(1, high + pad)]
}

export function shapeBox(points: readonly Point[]): Box {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const [x0, x1] = padSpan(clampSpan(Math.min(...xs), Math.max(...xs)))
  const [y0, y1] = padSpan(clampSpan(Math.min(...ys), Math.max(...ys)))
  return [x0, y0, x1, y1]
}

export function measureStepPlace(action: StoredAction): MeasureStepPlace | null {
  const shape = action.measure
  if (action.verb !== 'measure' || !shape || !action.documentId || !action.target) return null
  const box = shapeBox(shape.points)
  const [x0, y0, x1, y1] = box
  return {
    shape,
    box,
    place: {
      document: { id: action.documentId, name: action.target, shelf: 'stored' },
      page: firstPage(action.pages) ?? 1,
      frame: 'page',
      region: [x0, y0, x1 - x0, y1 - y0],
    },
  }
}

export function pointsInMark(box: Box, mark: Box, points: readonly Point[]): Point[] {
  const [bx0, by0, bx1, by1] = box
  const [mx0, my0, mx1, my1] = mark
  return points.map(([x, y]) => [
    mx0 + ((x - bx0) / (bx1 - bx0)) * (mx1 - mx0),
    my0 + ((y - by0) / (by1 - by0)) * (my1 - my0),
  ])
}

const length = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1])

export function labelPoint(quantity: StoredMeasure['quantity'], points: readonly Point[]): Point {
  if (quantity === 'area') {
    const sum = points.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0])
    return [sum[0] / points.length, sum[1] / points.length]
  }
  const total = points.slice(1).reduce((acc, point, index) => acc + length(points[index], point), 0)
  let left = total / 2
  for (let index = 1; index < points.length; index += 1) {
    const [a, b] = [points[index - 1], points[index]]
    const step = length(a, b)
    if (step >= left && step > 0) {
      const share = left / step
      return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]
    }
    left -= step
  }
  return points[0]
}

export function measuredValue(shape: StoredMeasure, locale: string): string {
  const number = shape.value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${number}\u00A0${shape.unit === 'm2' ? 'm²' : 'm'}`
}

export function basisLine(t: Translator, shape: StoredMeasure, locale: string): string {
  if (shape.basis === 'printed') return t('thinking.measure.basis.printed')
  if (shape.ratio === undefined) return t(`thinking.measure.basis.${shape.basis}Plain`)
  const ratio = Math.round(shape.ratio).toLocaleString(locale)
  return t(`thinking.measure.basis.${shape.basis}`, { ratio })
}
