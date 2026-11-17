/**
 * The run-ledger wire schemas, as JSON Schema, for the Python tier.
 *
 * The ledger is produced in Python and stored by this tier, which is exactly the
 * shape that grows two hand-written descriptions of one contract. So the zod
 * schemas in `./run-ledger-types` are the source, `lib/api/zod-json-schema.ts`
 * converts them, and `tests/fixtures/run-ledger.schema.json` is the committed
 * artifact both languages read — `packages/agent/src/agent/common/run_ledger.py` validates
 * its models against that file rather than restating the shape in Pydantic.
 *
 * The same arrangement the document lifecycle uses (ADR-0055), down to the
 * regeneration rule: `run-ledger-schema.spec.ts` rewrites the fixture under
 * `UPDATE_FIXTURES=1` and otherwise fails when it is stale.
 */

import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { RUN_LEDGER_LIFECYCLE, RUN_LEDGER_WIRE_SCHEMAS, TERMINAL_RUN_STATUSES } from './run-ledger-types'

export function runLedgerJsonSchema(): JsonSchemaNode {
  const document = jsonSchemaDocument(RUN_LEDGER_WIRE_SCHEMAS, {
    title: 'Grid run ledger wire contract',
    description:
      'Generated from apps/workspace/bff/runs/run-ledger-types.ts. Do not edit by hand: ' +
      'run-ledger-schema.spec.ts rewrites this file and fails when it is stale.',
  })
  // Not JSON Schema: the status moves this tier applies to what a producer
  // sends (ADR-0179), and the states a run has ended in. The Python tier keeps
  // a hand-written mirror of both and its tests compare it with this.
  return { ...document, 'x-lifecycle': { ...RUN_LEDGER_LIFECYCLE.statechart(), ended: [...TERMINAL_RUN_STATUSES] } }
}
