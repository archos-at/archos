/**
 * One operator alone, on a deployment that says so: `KNOWLEDGE_SINGLE_OPERATOR=true`,
 * set only by the dev (staging) stack (its `knowledgeSingleOperator` key). The
 * owner's decision of 2026-11-11: on dev, four eyes on platform change requests
 * only slows the team down; on prod nothing changes.
 *
 * This is the one place the BFF reads it. `platformTransaction` (`./store.ts`)
 * hands it to the database as the transaction-local `knowledge.single_operator`,
 * and the triggers of migration 0233 read it there: the author's own verdicts,
 * `sourceChecked` included, then count, and an override approval is marked
 * `single` with no second review left due. The override, its reason, the
 * person's own yes and the audit event stay as they are. Unset (prod, and the
 * default) nothing is set and every trigger is what 0208, 0214 and 0224 made it.
 */

import 'server-only'

export function singleOperator(): boolean {
  return (process.env.KNOWLEDGE_SINGLE_OPERATOR ?? '').trim().toLowerCase() === 'true'
}
