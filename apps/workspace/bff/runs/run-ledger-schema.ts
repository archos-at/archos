import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { RUN_LEDGER_LIFECYCLE, RUN_LEDGER_WIRE_SCHEMAS, TERMINAL_RUN_STATUSES } from './run-ledger-types'

export function runLedgerJsonSchema(): JsonSchemaNode {
  const document = jsonSchemaDocument(RUN_LEDGER_WIRE_SCHEMAS, {
    title: 'Grid run ledger wire contract',
    description:
      'Generated from apps/workspace/bff/runs/run-ledger-types.ts. Do not edit by hand: ' +
      'run-ledger-schema.spec.ts rewrites this file and fails when it is stale.',
  })
  return { ...document, 'x-lifecycle': { ...RUN_LEDGER_LIFECYCLE.statechart(), ended: [...TERMINAL_RUN_STATUSES] } }
}
