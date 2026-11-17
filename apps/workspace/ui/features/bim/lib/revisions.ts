import type { BimModelHeaderView } from '../hooks/use-bim-model'
import { revisionSeriesKey } from '@/lib/bim/revision-series'

export { revisionSeriesKey }

export interface BimRevisionDelta {
  previousFilename: string
  elements: number | null
  spaces: number | null
  storeys: number | null
  netFloorArea: number | null
  healthScore: number | null
}

export interface BimRevision {
  model: BimModelHeaderView
  index: number
  isLatest: boolean
  delta: BimRevisionDelta | null
}

export interface BimRevisionSeries {
  key: string
  label: string
  revisions: BimRevision[]
}

function metric(model: BimModelHeaderView): {
  elements: number | null
  spaces: number | null
  storeys: number | null
  netFloorArea: number | null
  healthScore: number | null
} {
  const summary = model.summary
  return {
    elements: summary?.totals.elements ?? null,
    spaces: summary?.totals.spaces ?? null,
    storeys: summary?.totals.storeys ?? null,
    netFloorArea: summary?.quantityTotals.netFloorAreaM2 ?? null,
    healthScore: summary?.health?.score ?? null,
  }
}

function difference(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null
  return Math.round((after - before) * 100) / 100
}

function computeDelta(
  current: BimModelHeaderView,
  previous: BimModelHeaderView
): BimRevisionDelta | null {
  if (!current.summary || !previous.summary) return null
  const now = metric(current)
  const before = metric(previous)
  return {
    previousFilename: previous.filename,
    elements: difference(now.elements, before.elements),
    spaces: difference(now.spaces, before.spaces),
    storeys: difference(now.storeys, before.storeys),
    netFloorArea: difference(now.netFloorArea, before.netFloorArea),
    healthScore: difference(now.healthScore, before.healthScore),
  }
}

export function groupModelRevisions(
  models: readonly BimModelHeaderView[]
): BimRevisionSeries[] {
  const buckets = new Map<string, BimModelHeaderView[]>()
  for (const model of models) {
    const key = revisionSeriesKey(model.filename)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(model)
    else buckets.set(key, [model])
  }

  const series: BimRevisionSeries[] = []
  for (const [key, bucket] of buckets) {
    const ordered = [...bucket].sort(
      (a, b) =>
        Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.filename.localeCompare(b.filename)
    )
    series.push({
      key,
      label: ordered[0].filename.replace(/\.(ifc|ifczip)$/i, ''),
      revisions: ordered.map((model, position) => ({
        model,
        index: position + 1,
        isLatest: position === ordered.length - 1,
        delta: position === 0 ? null : computeDelta(model, ordered[position - 1]),
      })),
    })
  }

  return series.sort((a, b) => {
    const latest = (entry: BimRevisionSeries): number =>
      Date.parse(entry.revisions[entry.revisions.length - 1].model.updatedAt)
    return latest(b) - latest(a) || a.label.localeCompare(b.label)
  })
}

export function findRevisionSeries(
  series: readonly BimRevisionSeries[],
  modelId: string | null
): BimRevisionSeries | null {
  if (!modelId) return null
  return (
    series.find((entry) => entry.revisions.some((revision) => revision.model.id === modelId)) ?? null
  )
}
