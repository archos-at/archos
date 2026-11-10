/**
 * Austria's Gebäudeklasse as a ruleset (ADR-0166): the OIB 2023 classification
 * that `project-intake/derivations.ts` encodes as code, held as data in
 * `seeds/at-oib-2023-building-class.json` and run on the one evaluator.
 *
 * This adapter is the seam between the profile and the evaluator: it reads a
 * Building's stored answers into typed facts (the same reading the derivation
 * uses) and gives the table's answer back in the derivation's own result shape,
 * so the spec can hold the two to each other case by case. Nothing in the
 * product calls it yet; the setup-facts slice (S9) moves `deriveBuildingClass`
 * onto it and retires the code rules.
 */

import seed from './seeds/at-oib-2023-building-class.json'
import {
  rulesetValuesSchema,
  type DecisionTable,
  type RulesetValues,
} from '@/lib/base-knowledge/wire/ruleset'
import {
  BUILDING_CLASS_INPUTS,
  readBuildingClassInput,
  type BuildingClass,
  type BuildingClassInput,
  type BuildingClassInputs,
  type BuildingClassResult,
} from '@/lib/project-intake/derivations'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { evaluateDecisionTable } from './decision-table'
import type { Facts } from './expression'

export const AT_OIB_2023_BUILDING_CLASS: RulesetValues = rulesetValuesSchema.parse(seed)

function tableOf(values: RulesetValues): DecisionTable {
  if (values.body.kind !== 'table') throw new Error('the building class ruleset carries its table')
  return values.body.payload
}

/**
 * D0's uses as the list the table reads; none given is unknown, as in the
 * derivation. A list holding anything but tokens is unreadable, so unknown:
 * the profile's type allows only strings, and a guess here would be a class.
 */
function readUses(raw: ProjectPrimitiveValue | undefined): string[] | null {
  const uses: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw !== ''
      ? [raw]
      : []
  if (uses.length === 0 || !uses.every((use): use is string => typeof use === 'string')) return null
  return uses
}

/** A Building's stored answers as the table's facts: `null` where the profile holds no readable answer. */
export function buildingClassFacts(inputs: BuildingClassInputs): Facts {
  const facts: Record<string, unknown> = {}
  for (const input of BUILDING_CLASS_INPUTS) {
    facts[input] =
      input === 'uses'
        ? readUses(inputs[input])
        : (readBuildingClassInput(input, inputs[input]) ?? null)
  }
  return facts
}

const CLASS_OF_CODE: Record<string, BuildingClass> = {
  'at-oib-2023:GK1': 1,
  'at-oib-2023:GK2': 2,
  'at-oib-2023:GK3': 3,
  'at-oib-2023:GK4': 4,
  'at-oib-2023:GK5': 5,
}

/** The building class of one Building, decided by the ruleset, in `deriveBuildingClass`'s result shape. */
export function buildingClassFromRuleset(
  inputs: BuildingClassInputs,
  ruleset: RulesetValues = AT_OIB_2023_BUILDING_CLASS
): BuildingClassResult {
  const result = evaluateDecisionTable(tableOf(ruleset), buildingClassFacts(inputs))
  if (result.status === 'undetermined') {
    const missing =
      result.reason === 'unknown_inputs' ? (result.unknownInputs as BuildingClassInput[]) : []
    return { value: null, hochhaus: false, applicable: true, missing }
  }
  return {
    value: CLASS_OF_CODE[String(result.then)] ?? null,
    hochhaus: result.then === 'hochhaus',
    applicable: result.then !== 'no_building',
    missing: [],
  }
}
