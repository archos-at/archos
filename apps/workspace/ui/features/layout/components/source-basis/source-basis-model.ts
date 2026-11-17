import type { DataSourceFromAPI } from '@/adapters/api'
import type { SourceSignal } from '@/lib/source-kinds'
import { classifySourceSignal } from '../../lib/source-presets'
import type { SourcePresetId } from '../../types'

export type SourceBasisState = 'on' | 'off' | 'unavailable' | 'always'

export interface SourceBasisEntry {
  id: string
  name: string
  description: string
  signal: SourceSignal
  state: SourceBasisState
  unavailableReason?: string
}

export const KNOWLEDGE_LAYER_ID = 'knowledge_layer'
export const KNOWLEDGE_PROJECT_ID = 'knowledge_layer:project'
export const KNOWLEDGE_OFFICE_ID = 'knowledge_layer:office'

export const STRATUM_ORDER: readonly SourceSignal[] = ['law', 'office', 'project', 'auto']

const strataIndex = (signal: SourceSignal): number => {
  const index = STRATUM_ORDER.indexOf(signal)
  return index === -1 ? STRATUM_ORDER.length : index
}

export interface SourceBasisLabels {
  projectName: string
  projectDescription: string
  officeName: string
  officeDescription: string
  signInRequired: string
}

export interface BuildSourceBasisInput {
  sources: readonly Pick<DataSourceFromAPI, 'id' | 'name' | 'description' | 'requires_auth'>[] | null | undefined
  enabledIds: readonly string[]
  knowledgeLayerAvailable: boolean
  hasValidToken: boolean
  labels: SourceBasisLabels
}

export interface SourceBasis {
  always: SourceBasisEntry[]
  external: SourceBasisEntry[]
}

export const buildSourceBasis = ({
  sources,
  enabledIds,
  knowledgeLayerAvailable,
  hasValidToken,
  labels,
}: BuildSourceBasisInput): SourceBasis => {
  const enabled = new Set(enabledIds)

  const always: SourceBasisEntry[] = knowledgeLayerAvailable
    ? [
        {
          id: KNOWLEDGE_PROJECT_ID,
          name: labels.projectName,
          description: labels.projectDescription,
          signal: 'project',
          state: 'always',
        },
        {
          id: KNOWLEDGE_OFFICE_ID,
          name: labels.officeName,
          description: labels.officeDescription,
          signal: 'office',
          state: 'always',
        },
      ]
    : []

  const external: SourceBasisEntry[] = (sources ?? [])
    .filter((source) => source.id !== KNOWLEDGE_LAYER_ID)
    .map((source) => {
      const available = !source.requires_auth || hasValidToken
      const state: SourceBasisState = !available ? 'unavailable' : enabled.has(source.id) ? 'on' : 'off'
      return {
        id: source.id,
        name: source.name,
        description: source.description ?? '',
        signal: classifySourceSignal(source),
        state,
        ...(available ? {} : { unavailableReason: labels.signInRequired }),
      }
    })
    .sort((a, b) => strataIndex(a.signal) - strataIndex(b.signal) || a.name.localeCompare(b.name))

  return { always, external }
}

export type BasisSummaryKind =
  | 'preset'
  | 'all'
  | 'internalOnly'
  | 'subset'

export interface BasisSummary {
  kind: BasisSummaryKind
  preset?: SourcePresetId
  strata: SourceSignal[]
  overflow: number
  consultedCount: number
}

export const MAX_TRIGGER_STRATA = 2

export const summariseBasis = (
  basis: SourceBasis,
  activePreset: SourcePresetId | null,
  maxStrata: number = MAX_TRIGGER_STRATA
): BasisSummary => {
  const selectable = basis.external.filter((entry) => entry.state !== 'unavailable')
  const on = selectable.filter((entry) => entry.state === 'on')
  const consultedCount = on.length + basis.always.length

  const strataOn = STRATUM_ORDER.filter((signal) => on.some((entry) => entry.signal === signal))

  if (activePreset) {
    return { kind: 'preset', preset: activePreset, strata: [], overflow: 0, consultedCount }
  }
  if (on.length === 0) {
    return { kind: 'internalOnly', strata: [], overflow: 0, consultedCount }
  }
  if (on.length === selectable.length) {
    return { kind: 'all', strata: [], overflow: 0, consultedCount }
  }
  return {
    kind: 'subset',
    strata: strataOn.slice(0, maxStrata),
    overflow: Math.max(0, strataOn.length - maxStrata),
    consultedCount,
  }
}

export const hasNoExternalSources = (basis: SourceBasis): boolean => {
  const selectable = basis.external.filter((entry) => entry.state !== 'unavailable')
  return selectable.length > 0 && selectable.every((entry) => entry.state === 'off')
}
