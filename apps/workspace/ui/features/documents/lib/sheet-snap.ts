import type { SnapScale, SnapTargets } from '@/lib/drawing-tape/snap-wire'

export type SharePoint = readonly [number, number]
export type SnapKind = 'vertex' | 'edge' | 'free'
export interface PagePixels {
  width: number
  height: number
}
export interface Snapped {
  at: [number, number]
  kind: Exclude<SnapKind, 'free'>
}

export function pageWideRatio(scales: readonly SnapScale[] | null): number | null {
  const ratios = (scales ?? []).flatMap((scale) =>
    scale.region === null && scale.ratio !== null ? [scale.ratio] : []
  )
  return ratios.length > 0 && ratios.every((ratio) => ratio === ratios[0]) ? ratios[0] : null
}

const CELLS = 96
const SAMPLES_PER_LEG = 9

export interface SnapIndex {
  vertices: readonly number[]
  segments: readonly number[]
  vertexCells: Map<number, number[]>
  segmentCells: Map<number, number[]>
}

const cellOf = (x: number, y: number) =>
  Math.min(CELLS - 1, Math.max(0, Math.floor(y * CELLS))) * CELLS +
  Math.min(CELLS - 1, Math.max(0, Math.floor(x * CELLS)))

function put(cells: Map<number, number[]>, cell: number, item: number) {
  const held = cells.get(cell)
  if (!held) cells.set(cell, [item])
  else if (held[held.length - 1] !== item) held.push(item)
}

export function buildSnapIndex(targets: Pick<SnapTargets, 'vertices' | 'segments'>): SnapIndex {
  const vertexCells = new Map<number, number[]>()
  const segmentCells = new Map<number, number[]>()
  const { vertices, segments } = targets
  for (let i = 0; i < vertices.length; i += 2)
    put(vertexCells, cellOf(vertices[i], vertices[i + 1]), i)
  for (let i = 0; i < segments.length; i += 4) {
    const [x0, y0, x1, y1] = [segments[i], segments[i + 1], segments[i + 2], segments[i + 3]]
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * CELLS * 2))
    const seen = new Set<number>()
    for (let step = 0; step <= steps; step += 1) {
      const cell = cellOf(x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps)
      if (!seen.has(cell)) {
        seen.add(cell)
        put(segmentCells, cell, i)
      }
    }
  }
  return { vertices, segments, vertexCells, segmentCells }
}

function* near(
  cells: Map<number, number[]>,
  point: SharePoint,
  reach: SharePoint
): Generator<number> {
  const first = [
    Math.floor((point[0] - reach[0]) * CELLS) - 1,
    Math.floor((point[1] - reach[1]) * CELLS) - 1,
  ]
  const last = [
    Math.floor((point[0] + reach[0]) * CELLS) + 1,
    Math.floor((point[1] + reach[1]) * CELLS) + 1,
  ]
  const seen = new Set<number>()
  for (let row = Math.max(0, first[1]); row <= Math.min(CELLS - 1, last[1]); row += 1) {
    for (let column = Math.max(0, first[0]); column <= Math.min(CELLS - 1, last[0]); column += 1) {
      for (const item of cells.get(row * CELLS + column) ?? []) {
        if (!seen.has(item)) {
          seen.add(item)
          yield item
        }
      }
    }
  }
}

function onSegment(index: SnapIndex, at: number, point: SharePoint, page: PagePixels) {
  const s = index.segments
  const [ax, ay] = [s[at] * page.width, s[at + 1] * page.height]
  const [bx, by] = [s[at + 2] * page.width, s[at + 3] * page.height]
  const [px, py] = [point[0] * page.width, point[1] * page.height]
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared))
  const [x, y] = [ax + t * (bx - ax), ay + t * (by - ay)]
  return {
    distance: Math.hypot(x - px, y - py),
    point: [x / page.width, y / page.height] as [number, number],
  }
}

export function snapPoint(
  index: SnapIndex,
  pointer: SharePoint,
  page: PagePixels,
  radiusPx: number
): Snapped | null {
  const reach: SharePoint = [radiusPx / page.width, radiusPx / page.height]
  let best: { distance: number; point: [number, number] } | null = null
  for (const at of near(index.vertexCells, pointer, reach)) {
    const point: [number, number] = [index.vertices[at], index.vertices[at + 1]]
    const distance = Math.hypot(
      (point[0] - pointer[0]) * page.width,
      (point[1] - pointer[1]) * page.height
    )
    if (distance <= radiusPx && (!best || distance < best.distance)) best = { distance, point }
  }
  if (best) return { at: best.point, kind: 'vertex' }
  for (const at of near(index.segmentCells, pointer, reach)) {
    const found = onSegment(index, at, pointer, page)
    if (found.distance <= radiusPx && (!best || found.distance < best.distance)) best = found
  }
  return best ? { at: best.point, kind: 'edge' } : null
}

const covers = (scale: SnapScale, [x, y]: SharePoint) =>
  !scale.region ||
  (scale.region[0] <= x && x <= scale.region[2] && scale.region[1] <= y && y <= scale.region[3])

const areaOf = (scale: SnapScale) =>
  scale.region ? (scale.region[2] - scale.region[0]) * (scale.region[3] - scale.region[1]) : 1

function smallest(scales: readonly SnapScale[], point: SharePoint): SnapScale | null {
  const pick = (found: SnapScale[]) =>
    found.reduce<SnapScale | null>(
      (kept, scale) => (!kept || areaOf(scale) < areaOf(kept) ? scale : kept),
      null
    )
  const calibrated = scales.filter(
    (scale) => scale.source === 'calibration' && covers(scale, point)
  )
  return pick(calibrated.length ? calibrated : scales.filter((scale) => covers(scale, point)))
}

export function scaleOf(
  points: readonly SharePoint[],
  scales: readonly SnapScale[],
  closed = false
) {
  if (points.length === 0) return null
  const legs = points.map(
    (point, i) => [point, points[i + 1] ?? (closed ? points[0] : null)] as const
  )
  const samples = legs.flatMap(([a, b]) =>
    b
      ? Array.from({ length: SAMPLES_PER_LEG }, (_, step): SharePoint => {
          const t = step / (SAMPLES_PER_LEG - 1)
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        })
      : [a]
  )
  const first = smallest(scales, samples[0])
  if (!first?.metresPerShare || samples.some((sample) => smallest(scales, sample) !== first))
    return null
  return first
}

export function provisionalLength(
  points: readonly SharePoint[],
  scales: readonly SnapScale[]
): number | null {
  const scale = points.length >= 2 ? scaleOf(points, scales) : null
  if (!scale?.metresPerShare) return null
  const [mx, my] = scale.metresPerShare
  return points
    .slice(1)
    .reduce(
      (sum, point, i) =>
        sum + Math.hypot((point[0] - points[i][0]) * mx, (point[1] - points[i][1]) * my),
      0
    )
}

export function provisionalArea(
  points: readonly SharePoint[],
  scales: readonly SnapScale[]
): number | null {
  const scale = points.length >= 3 ? scaleOf(points, scales, true) : null
  if (!scale?.metresPerShare) return null
  const [mx, my] = scale.metresPerShare
  const twice = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)
  return (Math.abs(twice) / 2) * mx * my
}
