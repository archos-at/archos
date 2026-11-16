import { formatMetresIn } from './format-value'
import { storeyKey } from './model-index'
import type { BimModelSummary, BimStorey } from '@/lib/bim/types'

export interface StageLevel {
  name: string
  elevation: number | null
  elementCount: number
}

export function stageLevels(summary: BimModelSummary | null | undefined): StageLevel[] {
  const storeys: readonly BimStorey[] = summary?.storeys ?? []
  return storeys
    .filter((storey): storey is BimStorey & { name: string } => Boolean(storey.name?.trim()))
    .map((storey) => ({
      name: storey.name.trim(),
      elevation: typeof storey.elevation === 'number' && Number.isFinite(storey.elevation)
        ? storey.elevation
        : null,
      elementCount: storey.elementCount,
    }))
    .sort((a, b) => {
      if (a.elevation === null && b.elevation === null) return a.name.localeCompare(b.name)
      if (a.elevation === null) return 1
      if (b.elevation === null) return -1
      return b.elevation - a.elevation
    })
}

export function levelElevation(
  summary: BimModelSummary | null | undefined,
  name: string | null
): number | null {
  if (!name) return null
  const match = stageLevels(summary).find((level) => storeyKey(level.name) === storeyKey(name))
  return match?.elevation ?? null
}

export function stageModelLabel(filename: string): string {
  return filename.replace(/\.(ifc|ifczip|ifcxml)$/i, '')
}

export function pickStageModel<T extends { filename: string; status: string; updatedAt: string }>(
  models: readonly T[],
  preferred: string | null | undefined
): T | null {
  if (models.length === 0) return null

  const wanted = preferred?.trim().toLowerCase()
  if (wanted) {
    const exact = models.find((model) => model.filename.toLowerCase() === wanted)
    if (exact) return exact
    const stem = wanted.replace(/\.(ifc|ifczip|zip)$/i, '')
    const partial =
      stem === '' ? undefined : models.find((model) => model.filename.toLowerCase().includes(stem))
    if (partial) return partial
  }

  const ready = models.filter((model) => model.status === 'ready')
  const pool = ready.length > 0 ? ready : models
  return [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

export function formatLevelElevation(metres: number, locale: string): string {
  const rounded = Math.round(metres * 100) / 100
  const digits = formatMetresIn(Math.abs(rounded), locale)
  if (rounded === 0) return `±${digits}`
  return `${rounded > 0 ? '+' : '−'}${digits}`
}

export function readableIfcType(ifcType: string): string {
  return ifcType.replace(/^Ifc/, '').replace(/StandardCase$/, '').replace(/ElementedCase$/, '')
}

export function humaniseIfcType(ifcType: string): string {
  return readableIfcType(ifcType)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}


export function stageModelMatched<T extends { filename: string }>(
  opened: T | null,
  preferred: string | null | undefined
): boolean {
  const wanted = preferred?.trim().toLowerCase()
  if (!wanted) return true
  if (!opened) return false
  const name = opened.filename.toLowerCase()
  const stem = wanted.replace(/\.(ifc|ifczip|zip)$/i, '')
  return name === wanted || (stem !== '' && name.includes(stem))
}
