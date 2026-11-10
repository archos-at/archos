/**
 * A ruleset's values as the body columns of `knowledge_ruleset_revisions`
 * (migrations 0204 and 0207). Pure, so an office write and a platform proposal
 * store one shape: a decision table or a setup record (`fact_definitions.v1`,
 * `fact_sources.v1`, ADR-0169) with its schema and payload, or a deferral.
 */

import type { RulesetValues } from '@/lib/base-knowledge/wire/ruleset'

export function rulesetColumns(values: RulesetValues) {
  const table = values.body.kind === 'inherits' ? null : values.body
  return {
    purpose: values.purpose,
    territoryIds: values.territoryIds,
    workIds: values.workIds,
    validFrom: values.validFrom,
    validTo: values.validTo,
    basisEditionId: values.basisEditionId,
    inherits: table ? null : ('parent' as const),
    payloadSchema: table ? table.payloadSchema : null,
    payload: table ? table.payload : null,
  }
}
