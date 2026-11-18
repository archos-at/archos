import 'server-only'
import type { BimQuery } from './query-schema'
import type { BimHealth } from './validate'
import type { BimComparison } from './compare'
import type { BimQuantityRow, BimRoomSchedule } from './schedule'
import type { BimComplianceChange, BimComplianceSummary, BimRuleResult } from './rules'
import type { BimProfileSuggestion } from './profile'
import type { BimElementListRow, BimGroupedCount, BimPropertyCatalogEntry, findBimElement } from './repository'
import type { BimModelSummary, BimUnits } from './types'

export interface BimQueryResult {
  op: BimQuery['op']
  model: {
    id: string
    filename: string
    schema: string | null
    elementCount: number
  }
  summary: string
  overview?: BimModelSummary
  health?: BimHealth
  caveat?: string | null
  comparison?: BimComparison
  schedule?: BimRoomSchedule
  compliance?: BimRuleResult[]
  complianceSummary?: BimComplianceSummary
  complianceChanges?: BimComplianceChange[]
  comparedWith?: string
  complianceShoppingList?: Array<{ path: string; elements: number; rules: string[] }>
  takeoff?: BimQuantityRow[]
  profileSuggestions?: BimProfileSuggestion[]
  types?: Array<{ ifcType: string; elements: number }>
  elements?: BimElementListRow[]
  element?: Awaited<ReturnType<typeof findBimElement>>
  properties?: BimPropertyCatalogEntry[]
  propertyScan?: { scanned: number; total: number; complete: boolean }
  groups?: BimGroupedCount[]
  units?: BimUnits
  total?: number
  totalIsLowerBound?: boolean
  truncated?: boolean
}
