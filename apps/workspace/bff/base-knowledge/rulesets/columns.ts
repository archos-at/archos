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
