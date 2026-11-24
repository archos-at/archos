// The engine stood in for /dev/drawing-tape: the annotations sheet's own lines as snap targets at 1:100, and a measure
// that answers from the same geometry, so every number on the page is the stand-in engine's, never the browser's.
import type { PagePoint } from '@/lib/annotations/measure-shapes'
import type { AnnotationView } from '@/lib/annotations/types'
import type { TapeMeasurement } from '@/lib/drawing-tape/wire'
import { base, FILE, SHEET_HEIGHT, SHEET_WIDTH } from '../annotations/fixtures'

const RATIO = 100
const METRES_PER_PT = (25.4 / 72 / 1000) * RATIO
const MPS: [number, number] = [SHEET_WIDTH * METRES_PER_PT, SHEET_HEIGHT * METRES_PER_PT]

type Line = [number, number, number, number]
const rect = (x: number, y: number, w: number, h: number): Line[] => [
  [x, y, x + w, y],
  [x + w, y, x + w, y + h],
  [x + w, y + h, x, y + h],
  [x, y + h, x, y],
]
const LINES: Line[] = [
  ...rect(50, 80, 520, 420),
  [50, 270, 570, 270],
  [50, 320, 570, 320],
  ...[190, 330, 450].flatMap((x): Line[] => [
    [x, 320, x, 500],
    [x, 80, x, 270],
  ]),
  ...rect(470, 110, 80, 140),
  ...Array.from({ length: 10 }, (_, step): Line => [470, 110 + step * 14, 550, 110 + step * 14]),
  ...rect(600, 40, 220, 70),
]
const share = (x: number, y: number): PagePoint => [+(x / SHEET_WIDTH).toFixed(5), +(1 - y / SHEET_HEIGHT).toFixed(5)]

function crossings(): number[] {
  const out: number[] = []
  for (const [i, a] of LINES.entries()) {
    for (const b of LINES.slice(i + 1)) {
      const aH = a[1] === a[3]
      const bH = b[1] === b[3]
      if (aH === bH) continue
      const [h, v] = aH ? [a, b] : [b, a]
      const x = v[0]
      const y = h[1]
      const within = (lo: number, hi: number, at: number) => at >= Math.min(lo, hi) - 0.01 && at <= Math.max(lo, hi) + 0.01
      if (within(h[0], h[2], x) && within(v[1], v[3], y)) out.push(...share(x, y))
    }
  }
  return out
}

export const TAPE_TARGETS = {
  documentId: FILE.id,
  versionId: 'dev-version-3',
  page: 1,
  widthPt: SHEET_WIDTH,
  heightPt: SHEET_HEIGHT,
  widthMm: (SHEET_WIDTH * 25.4) / 72,
  heightMm: (SHEET_HEIGHT * 25.4) / 72,
  rotation: 0,
  scan: false,
  vertices: [...LINES.flatMap(([x0, y0, x1, y1]) => [...share(x0, y0), ...share(x1, y1)]), ...crossings()],
  segments: LINES.flatMap(([x0, y0, x1, y1]) => [...share(x0, y0), ...share(x1, y1)]),
  totalSegments: LINES.length,
  truncated: false,
  scales: [{ region: null, state: 'estimated' as const, source: 'scale_note' as const, metresPerShare: MPS, ratio: RATIO }],
}

const length = (points: readonly PagePoint[]) =>
  points.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot((x - points[i][0]) * MPS[0], (y - points[i][1]) * MPS[1]), 0)
const area = (points: readonly PagePoint[]) =>
  Math.abs(
    points.reduce((sum, [x0, y0], i) => {
      const [x1, y1] = points[(i + 1) % points.length]
      return sum + x0 * MPS[0] * (y1 * MPS[1]) - x1 * MPS[0] * (y0 * MPS[1])
    }, 0) / 2
  )

export function measured(operation: string, points: PagePoint[]): TapeMeasurement {
  const isArea = operation === 'area'
  const value = isArea ? area(points) : length(points)
  const tolerance = isArea ? value * 0.006 : 0.03 + value * 0.002
  return {
    quantity: operation,
    value,
    unit: isArea ? 'm2' : 'm',
    low: value - tolerance,
    high: value + tolerance,
    provenance: 'vector_estimated',
    scaleState: 'estimated',
    scaleRatio: RATIO,
    printed: null,
    verdict: null,
    reasons: [],
    points,
  }
}

const reading = ({ value, unit, low, high, provenance, scaleState, scaleRatio }: TapeMeasurement) => ({
  value,
  unit,
  low,
  high,
  provenance,
  scaleState,
  scaleRatio,
})

const kept = (number: number, shape: 'line' | 'polygon', body: string, points: PagePoint[]): AnnotationView =>
  ({
    ...base,
    id: `tape-${number}`,
    number,
    kind: 'hint',
    body,
    mentions: [],
    shape,
    x: points[0][0],
    y: points[0][1],
    points,
    reading: reading(measured(shape === 'polygon' ? 'area' : 'distance', points)),
    canEdit: true,
    canDelete: true,
  }) as AnnotationView

export const KEPT: AnnotationView[] = [
  kept(4, 'line', 'Gangbreite', [share(250, 320), share(250, 270)]),
  kept(5, 'polygon', 'Zimmer 1', [share(50, 80), share(190, 80), share(190, 270), share(50, 270)]),
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const unscaled = () => typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('scale') === 'none'
const NO_SCALE = {
  code: 'uncalibrated',
  reason: 'No scale is known for this part of the sheet.',
  remedy: 'Set the scale from a known length.',
  scaleState: null,
  candidates: [],
}

export const tapeFetch = (inner: typeof fetch) => {
  let added: AnnotationView[] = [...KEPT]
  let next = 40
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const root = `/api/documents/${FILE.id}`
    if (url.startsWith(`${root}/snap-targets`)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return json({ targets: unscaled() ? { ...TAPE_TARGETS, scales: [] } : TAPE_TARGETS })
    }
    if (url.endsWith(`${root}/measure`) && method === 'POST') {
      const { operation, points } = JSON.parse(String(init?.body)) as { operation: string; points: PagePoint[] }
      await new Promise((resolve) => setTimeout(resolve, 450))
      if (unscaled()) return json({ noNumber: NO_SCALE })
      return json({ measurement: measured(operation, points) })
    }
    if (url.endsWith(`${root}/annotations`) && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Partial<AnnotationView> & { points?: PagePoint[] }
      if (body.points) {
        const shape = body.shape === 'polygon' ? 'polygon' : 'line'
        const created = { ...kept(next, shape, String(body.body ?? ''), body.points), shape: body.shape ?? 'line' } as AnnotationView
        next += 1
        added = [...added, created]
        return json({ annotation: created }, 201)
      }
    }
    const response = await inner(input, init)
    if (url.endsWith(`${root}/annotations`) && method === 'GET' && response.ok) {
      const listed = (await response.json()) as { annotations: AnnotationView[] }
      return json({ ...listed, annotations: [...listed.annotations, ...added], canMeasure: true })
    }
    return response
  }
}
