import type { BimSpatialNode, BimStorey } from '@/lib/bim/types'

export type BimHighlightStatus = 'pass' | 'fail' | 'warning' | 'info'

export const BIM_HIGHLIGHT_STATUSES: readonly BimHighlightStatus[] = [
  'pass',
  'fail',
  'warning',
  'info',
]

export interface BimViewerElement {
  globalId: string
  expressId: number
  ifcType: string
  name: string | null
  storeyName: string | null
  tag?: string | null
  predefinedType?: string | null
}

export interface BimHighlightGroup {
  globalIds: string[]
  label: string
  status: BimHighlightStatus
}

export interface ResolvedHighlight extends BimHighlightGroup {
  expressIds: number[]
  unresolved: string[]
}

export type Rgba = [number, number, number, number]

export const HIGHLIGHT_RGBA: Record<BimHighlightStatus, Rgba> = {
  pass: [0.13, 0.66, 0.37, 1],
  fail: [0.86, 0.21, 0.27, 1],
  warning: [0.94, 0.66, 0.13, 1],
  info: [0.16, 0.47, 0.93, 1],
}

export const HIGHLIGHT_CSS: Record<BimHighlightStatus, string> = {
  pass: 'rgb(33 168 94)',
  fail: 'rgb(219 54 69)',
  warning: 'rgb(240 168 33)',
  info: 'rgb(41 120 237)',
}

export function supportsWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)
}

export function buildExpressIdIndex(
  elements: readonly BimViewerElement[]
): Map<string, number> {
  const index = new Map<string, number>()
  for (const element of elements) index.set(element.globalId, element.expressId)
  return index
}

export function buildElementIndex(
  elements: readonly BimViewerElement[]
): Map<number, BimViewerElement> {
  const index = new Map<number, BimViewerElement>()
  for (const element of elements) index.set(element.expressId, element)
  return index
}

export function resolveHighlights(
  groups: readonly BimHighlightGroup[],
  elements: readonly BimViewerElement[]
): ResolvedHighlight[] {
  const byGlobalId = buildExpressIdIndex(elements)
  return groups.map((group) => {
    const expressIds: number[] = []
    const unresolved: string[] = []
    for (const globalId of group.globalIds) {
      const expressId = byGlobalId.get(globalId)
      if (expressId === undefined) unresolved.push(globalId)
      else expressIds.push(expressId)
    }
    return { ...group, expressIds, unresolved }
  })
}

export function buildColorOverrides(
  highlights: readonly ResolvedHighlight[]
): Map<number, Rgba> {
  const overrides = new Map<number, Rgba>()
  for (const highlight of highlights) {
    const colour = HIGHLIGHT_RGBA[highlight.status]
    for (const expressId of highlight.expressIds) overrides.set(expressId, colour)
  }
  return overrides
}

export function highlightedExpressIds(highlights: readonly ResolvedHighlight[]): Set<number> {
  const ids = new Set<number>()
  for (const highlight of highlights) for (const id of highlight.expressIds) ids.add(id)
  return ids
}

export function storeyKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

export function expressIdsForStorey(
  elements: readonly BimViewerElement[],
  storeyName: string | null
): Set<number> | null {
  if (!storeyName) return null
  const needle = storeyKey(storeyName)
  const ids = new Set<number>()
  let anyStoreyAssignment = false
  for (const element of elements) {
    if (element.storeyName) anyStoreyAssignment = true
    if (storeyKey(element.storeyName) === needle) ids.add(element.expressId)
  }
  if (!anyStoreyAssignment) return null
  return ids
}

export interface ViewerVisibility {
  hidden: ReadonlySet<number>
  isolated: ReadonlySet<number> | null
}

export const NOTHING_HIDDEN: ViewerVisibility = { hidden: new Set(), isolated: null }

export function hasVisibilityEdits(visibility: ViewerVisibility): boolean {
  return visibility.hidden.size > 0 || visibility.isolated !== null
}

export function sameVisibility(a: ViewerVisibility, b: ViewerVisibility): boolean {
  return sameIdSet(a.hidden, b.hidden) && sameIdSet(a.isolated, b.isolated)
}

export function sameIdSet(a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

export function resolveIsolation(
  storeyIds: ReadonlySet<number> | null,
  isolated: ReadonlySet<number> | null
): Set<number> | null {
  if (!storeyIds && !isolated) return null
  if (!storeyIds) return new Set(isolated)
  if (!isolated) return new Set(storeyIds)
  const both = new Set<number>()
  for (const id of isolated) if (storeyIds.has(id)) both.add(id)
  return both
}

export function selectionSurvives(
  selectedExpressId: number | null,
  visibility: ViewerVisibility
): boolean {
  if (selectedExpressId === null) return false
  if (visibility.hidden.has(selectedExpressId)) return false
  if (visibility.isolated && !visibility.isolated.has(selectedExpressId)) return false
  return true
}

export interface SpatialTreeRow {
  key: string
  depth: number
  label: string
  ifcType: string
  elementCount: number
  elevation: number | null
  storeyName: string | null
}

export function flattenSpatialTree(node: BimSpatialNode | null): SpatialTreeRow[] {
  if (!node) return []
  const rows: SpatialTreeRow[] = []
  const visit = (current: BimSpatialNode, depth: number, storeyName: string | null) => {
    const isStorey = current.ifcType === 'IfcBuildingStorey'
    const inheritedStorey = isStorey ? current.name : storeyName
    rows.push({
      key: current.globalId ?? `express:${current.expressId}`,
      depth,
      label: current.name ?? current.ifcType,
      ifcType: current.ifcType,
      elementCount: current.elementCount,
      elevation: current.elevation,
      storeyName: isStorey ? current.name : null,
    })
    for (const child of current.children) visit(child, depth + 1, inheritedStorey)
  }
  visit(node, 0, null)
  return rows
}

export function formatElevation(storey: Pick<BimStorey, 'elevation'>, locale: string): string {
  if (storey.elevation === null) return '—'
  const rounded = Math.round(storey.elevation * 100) / 100
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString(locale)} m`
}

export function shortIfcType(ifcType: string): string {
  return ifcType.startsWith('Ifc') ? ifcType.slice(3) : ifcType
}
