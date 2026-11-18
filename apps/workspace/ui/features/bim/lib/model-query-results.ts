import type { BimProfileSuggestion } from '@/lib/bim/profile'
import type { BimQuantityRow, BimRoomSchedule } from '@/lib/bim/schedule'
import type { BimComplianceSummary, BimRuleResult, BimRuleResultWithConfirmation } from '@/lib/bim/rules'

export interface BimQueryResponse {
  summary?: string
  caveat?: string | null
  truncated?: boolean
  compliance?: BimRuleResult[]
  complianceSummary?: BimComplianceSummary
  complianceShoppingList?: Array<{ path: string; elements: number; rules: string[] }>
  schedule?: BimRoomSchedule
  takeoff?: BimQuantityRow[]
  profileSuggestions?: BimProfileSuggestion[]
}

export const selectSchedule = (
  body: BimQueryResponse
): { schedule: BimRoomSchedule; truncated: boolean } | null =>
  body.schedule ? { schedule: body.schedule, truncated: body.truncated ?? false } : null
export const selectTakeoff = (
  body: BimQueryResponse
): { rows: BimQuantityRow[]; truncated: boolean } | null =>
  body.takeoff ? { rows: body.takeoff, truncated: body.truncated ?? false } : null
export const selectProfile = (body: BimQueryResponse): BimProfileSuggestion[] | null =>
  body.profileSuggestions ?? null

export interface BimComplianceView {
  rules: BimRuleResultWithConfirmation[]
  summary: BimComplianceSummary | null
  shoppingList: Array<{ path: string; elements: number; rules: string[] }>
  truncated: boolean
}

export const selectCompliance = (body: BimQueryResponse): BimComplianceView | null =>
  body.compliance
    ? {
        rules: body.compliance.map((rule) => ({
          ...rule,
          confirmation: null,
          confirmationStale: false,
        })),
        summary: body.complianceSummary ?? null,
        shoppingList: body.complianceShoppingList ?? [],
        truncated: body.truncated === true,
      }
    : null
