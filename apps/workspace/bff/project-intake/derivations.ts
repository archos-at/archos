import {
  classifyWithTable,
  type BuildingClassInputs,
  type BuildingClassResult,
} from '@/lib/base-knowledge/rulesets/building-class'
import type { BuildingClassification } from './setup-scope'

export type { BuildingClassInputs, BuildingClassResult }

export function deriveBuildingClass(
  classification: BuildingClassification,
  inputs: BuildingClassInputs
): BuildingClassResult {
  return classifyWithTable(classification.table, classification.derivation, inputs, classification.definitions.facts)
}
