import type { RuleBasis } from './rule-basis'
import type { BimElement } from './types'

export type BimCheckStatus = 'pass' | 'fail' | 'undecidable'

export interface BimRuleFacts {
  bases: Readonly<Record<string, RuleBasis>>
  buildingClass?: number | null
  mainUse?: string | null
  storeys?: Array<{ name: string; elevation: number | null }>
  lengthScale?: number | null
}

export interface BimElementVerdict {
  globalId: string
  name: string | null
  storeyName: string | null
  status: BimCheckStatus
  reading: string
}

export interface BimMissingProperty {
  path: string
  elements: number
}

export interface BimRuleResult {
  ruleId: string
  richtlinie: string
  clause: string
  titleDe: string
  thresholdDe: string
  applicable: boolean
  notApplicableReason?: string
  hint?: string
  passed: number
  failed: number
  undecidable: number
  failures: BimElementVerdict[]
  unknowns: BimElementVerdict[]
  truncated: boolean
  missing: BimMissingProperty[]
}

export interface RuleDefinition {
  id: string
  designation: string
  edition: string
  clause: string
  titleDe: string
  thresholdDe: string
  ifcTypes: string[]
  scope?: (element: BimElement) => boolean
  notApplicable?: (facts: BimRuleFacts) => string | null
  judge: (
    element: BimElement,
    facts: BimRuleFacts
  ) => { status: BimCheckStatus; reading: string; missing?: string }
}
