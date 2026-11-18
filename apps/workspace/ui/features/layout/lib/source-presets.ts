import type { DataSourceFromAPI } from '@/adapters/api'
import type { SourceSignal } from '@/lib/source-kinds'
import type { SourcePresetId } from '../types'

const LAW_RE = /(^|[^a-z])ris([^a-z]|$)|recht|\blaw\b|richtlin|oib|norm|gesetz/i
const PROJECT_RE = /knowledge|projekt|project|unterlag|document|dokument|file|upload/i
const OFFICE_RE = /archiv|archive|office|b[uü]ro/i

const PRESET_SIGNAL: Record<SourcePresetId, SourceSignal> = {
  law: 'law',
  project: 'project',
  office: 'office',
}

export type ClassifiableSource = Pick<DataSourceFromAPI, 'id' | 'name'> & {
  description?: string
}

export const classifySourceSignal = (source: ClassifiableSource): SourceSignal => {
  const haystacks = [source.id, source.name ?? '']
  for (const value of haystacks) {
    if (!value) continue
    if (LAW_RE.test(value)) return 'law'
    if (OFFICE_RE.test(value)) return 'office'
    if (PROJECT_RE.test(value)) return 'project'
  }
  return 'auto'
}

export const computePresetSourceIds = (
  preset: SourcePresetId,
  sources: ClassifiableSource[] | null | undefined
): string[] => {
  if (!sources || sources.length === 0) return []
  const signal = PRESET_SIGNAL[preset]
  return sources.filter((source) => classifySourceSignal(source) === signal).map((s) => s.id)
}
