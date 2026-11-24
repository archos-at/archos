# Registered backfills: `apps/workspace/backfills`

One directory per stored-data rewrite the deploy runs on every deploy. Fields, phases and what
the Job does: [`backfills.md`](../../../docs/deployment/backfills.md).

- Write each backfill to run on every deploy and find 0 after the first: `scripts/rls-test-db.sh`
  runs every SQL one twice and fails a second run that writes.
- `phase` is `before-readers` for a copy new readers need, `after-switch` for a rewrite of what old
  writers still write. An `after-switch` failure leaves the release rolled out and the deploy red.
- `database` defaults to `app`; a table of the Python backend is in `jobs`
  ([`schema.md`](../../../docs/database/schema.md)). Querying the wrong one finds no rows, not an error.
- A rewrite that switches writers ships with `deploy/rollout/switches/<name>.json` naming its expand
  ([`expand-and-switch.md`](../../../docs/deployment/expand-and-switch.md)); CI refuses it until prod runs the expand.
- Read a run's counts in PostHog Logs: search `"event":"backfill.` for its `backfill.count` lines.
