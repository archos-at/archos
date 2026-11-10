/**
 * A ruleset's values as the body columns of `knowledge_ruleset_revisions`
 * (migration 0204). Pure, so an office write and a platform proposal store one
 * shape.
 */

import type { RulesetValues } from '@/lib/base-knowledge/wire/ruleset'

export function rulesetColumns(values: RulesetValues) {
  const table = values.body.kind === 'table' ? values.body : null
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
