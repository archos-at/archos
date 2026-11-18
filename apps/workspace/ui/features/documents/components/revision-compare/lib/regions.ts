import type { CompareRegion, PageSize } from '../types'

export interface PixelBox {
  left: number
  top: number
  width: number
  height: number
}

const unit = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0)

export function regionToPixels(
  region: Pick<CompareRegion, 'x' | 'y' | 'w' | 'h'>,
  size: PageSize,
): PixelBox {
  const x = unit(region.x)
  const y = unit(region.y)
  const w = Math.min(unit(region.w), 1 - x)
  const h = Math.min(unit(region.h), 1 - y)
  return {
    left: x * size.width,
    top: y * size.height,
    width: w * size.width,
    height: h * size.height,
  }
}

export interface NumberedRegion {
  number: number
  region: CompareRegion
}

export function numberRegions(regions: readonly CompareRegion[]): NumberedRegion[] {
  return regions.map((region, index) => ({ number: index + 1, region }))
}

export function regionsOnPage(regions: readonly NumberedRegion[], page: number): NumberedRegion[] {
  return regions.filter((entry) => entry.region.page === page)
}

export interface PageAnswer {
  regions: readonly CompareRegion[]
  summary: readonly string[]
}

export function mergeAnswers(answers: ReadonlyMap<number, PageAnswer>): CompareRegion[] {
  return [...answers].flatMap(([page, answer]) => answer.regions.map((region) => ({ ...region, page })))
}

export interface ChangeRow extends NumberedRegion {
  sentence?: string
}

export interface ChangeGroup {
  page: number
  rows: ChangeRow[]
  notes: string[]
}

const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export function groupByPage(
  regions: readonly NumberedRegion[],
  sentences: ReadonlyMap<number, readonly string[]> = new Map(),
): ChangeGroup[] {
  const pages = new Set<number>([...regions.map((entry) => entry.region.page), ...sentences.keys()])
  return [...pages]
    .sort((a, b) => a - b)
    .map((page) => {
      const onPage = regionsOnPage(regions, page).sort((a, b) => a.number - b.number)
      const lines = [...(sentences.get(page) ?? [])]
      const repeats = (line: string): boolean => onPage.some((entry) => sameText(entry.region.label, line))
      if (onPage.length > 0 && lines.length === onPage.length) {
        return {
          page,
          rows: onPage.map((entry, index) => {
            const line = lines[index] ?? ''
            return sameText(line, entry.region.label) ? { ...entry } : { ...entry, sentence: line }
          }),
          notes: [],
        }
      }
      return { page, rows: onPage.map((entry) => ({ ...entry })), notes: lines.filter((line) => !repeats(line)) }
    })
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export function centeredScroll(
  frame: Rect & { scrollLeft: number; scrollTop: number; scrollWidth: number; scrollHeight: number },
  box: Rect,
): { left: number; top: number } {
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), Math.max(max, 0))
  const left = frame.scrollLeft + (box.left - frame.left) - (frame.width - box.width) / 2
  const top = frame.scrollTop + (box.top - frame.top) - (frame.height - box.height) / 2
  return {
    left: clamp(left, frame.scrollWidth - frame.width),
    top: clamp(top, frame.scrollHeight - frame.height),
  }
}
