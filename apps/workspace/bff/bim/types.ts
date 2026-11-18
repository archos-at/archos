import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import type { BimHealth } from './validate'

export type BimPropertyValue = string | number | boolean | null

export type BimPropertySets = Record<string, Record<string, BimPropertyValue>>

export type BimQuantitySets = Record<string, Record<string, number>>

export type BimContainerKind = 'storey' | 'space' | 'building' | 'site' | 'project'

export interface BimElement {
  globalId: string
  expressId: number
  ifcType: string
  name: string | null
  description: string | null
  predefinedType: string | null
  objectType: string | null
  tag: string | null
  typeName: string | null
  containerKind: BimContainerKind | null
  containerGlobalId: string | null
  containerName: string | null
  storeyGlobalId: string | null
  storeyName: string | null
  materials: string[]
  classifications: BimClassification[]
  properties: BimPropertySets
  quantities: BimQuantitySets
}

export interface BimClassification {
  system: string | null
  identification: string | null
  name: string | null
}

export interface BimSpatialNode {
  globalId: string | null
  expressId: number
  ifcType: string
  name: string | null
  elevation: number | null
  elementCount: number
  children: BimSpatialNode[]
}

export interface BimStorey {
  globalId: string | null
  expressId: number
  name: string | null
  elevation: number | null
  elementCount: number
}

export interface BimHeader {
  name: string | null
  timeStamp: string | null
  author: string[]
  organization: string[]
  preprocessorVersion: string | null
  originatingSystem: string | null
  description: string[]
}

export interface BimUnit {
  symbol: string
  siScale: number
}

export interface BimUnits {
  length: BimUnit | null
  area: BimUnit | null
  volume: BimUnit | null
}

export interface BimModelSummary {
  schema: string | null
  header: BimHeader
  units: BimUnits
  projectName: string | null
  siteName: string | null
  buildingNames: string[]
  storeys: BimStorey[]
  spatial: BimSpatialNode | null
  typeCounts: Record<string, number>
  propertySetNames: string[]
  quantitySetNames: string[]
  materialNames: string[]
  totals: {
    entities: number
    elements: number
    spaces: number
    storeys: number
  }
  quantityTotals: {
    netFloorAreaM2: number | null
    grossFloorAreaM2: number | null
    netVolumeM3: number | null
  }
  health: BimHealth | null
  parseMs: number
  fileSizeBytes: number
  truncatedAt: number | null
}

export interface BimModelIndex extends BimModelSummary {
  elements: BimElement[]
  unreadableEntities: number
}

export const BIM_MODEL_STATUSES = ['pending', 'extracting', 'ready', 'failed'] as const

export type BimModelStatus = (typeof BIM_MODEL_STATUSES)[number]

export const BIM_MODEL_LIFECYCLE = defineLifecycle<BimModelStatus, 'start' | 'complete' | 'fail'>({
  id: 'bim-model',
  initial: 'pending',
  bornAs: ['extracting'],
  states: {
    pending: { on: { start: 'extracting' } },
    extracting: { on: { start: 'extracting', complete: 'ready', fail: 'failed' } },
    ready: { on: { start: 'extracting' } },
    failed: { on: { start: 'extracting' } },
  },
})

export const IFC_EXTENSIONS = ['.ifc', '.ifczip'] as const

export const IFC_MIME_TYPES = [
  'application/x-step',
  'application/step',
  'model/ifc',
  'application/ifc',
  'application/x-ifc',
] as const

export { DEFAULT_MAX_IFC_BYTES, maxIfcBytesFrom } from '@/shared/config/request-body-limit'

export const BIM_ELEMENTS_PAGE_LIMIT = 1_000

export const BIM_ELEMENT_OFFSET_LIMIT = 1_000_000

export function isIfcFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase()
  return IFC_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
