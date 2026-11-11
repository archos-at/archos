/**
 * The building class derivation (`docs/design/agentic-project-intake.md`, „The
 * building class derivation"; ADR-0169). Pure: a Building's values in, a class
 * and the inputs that still matter out.
 *
 * The rules are not here. The project's site selects its country's
 * classification table (`setup-scope.ts`), the one evaluator runs it under
 * three-valued logic, and the country's derivation definition says what each
 * answer means. Austria's table encodes the OIB-Richtlinien,
 * Begriffsbestimmungen (Ausgabe Mai 2023); the Richtlinie and the
 * `gebaeudeklasse` skill stay the authority, and where the table and the
 * Wortlaut disagree, the Wortlaut wins.
 *
 * The code this replaces enumerated bands of every missing input; it is kept
 * as the oracle the parity spec holds this to (`derivations.oracle.ts`).
 */

import {
  classifyWithTable,
  type BuildingClassInputs,
  type BuildingClassResult,
} from '@/lib/base-knowledge/rulesets/building-class'
import type { BuildingClassification } from './setup-scope'

export type { BuildingClassInputs, BuildingClassResult }

/** The building class of one Building from its inputs, keyed by the table's input keys. */
export function deriveBuildingClass(
  classification: BuildingClassification,
  inputs: BuildingClassInputs
): BuildingClassResult {
  return classifyWithTable(classification.table, classification.derivation, inputs, classification.definitions.facts)
}
