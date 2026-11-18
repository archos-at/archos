# Backfills: registered, run by the deploy

A stored-data rewrite that a migration cannot do in one transaction (a rename
that must wait until every writer is switched, a Qdrant payload copy) is a
**registered backfill**. The deploy runs every one of them on every deploy;
nobody runs one with `kubectl exec`.

## Register one

One directory under [`apps/workspace/backfills/`](../../apps/workspace/backfills/)
per backfill, named in lower-case words joined by hyphens, with a
`backfill.json` whose first line carries the expiry marker
(`check_legacy_expiry` reads it there, and the loader refuses any other
first line):

```json
{"expires": "drop after release 2026-W50",
  "kind": "sql",
  "phase": "after-switch",
  "dryRun": "dry-run.sql",
  "apply": "apply.sql"
}
```

| Field | Values |
|---|---|
| `kind` | `sql`: two files beside the manifest. `dryRun` returns one row per store, `store` and `rows`, read-only. `apply` rewrites, as the database owner, outside a transaction (a `DO` block may `COMMIT` per batch). `qdrant`: `command`, the dry run's argv in the backend image (the repository is under `/app`); `command --apply` writes; `command --check` is a dry run that exits 1 while anything is left. |
| `phase` | `before-readers`: after the migrations and before any workload that reads Postgres or Qdrant rolls out, for a copy the new readers need (the Qdrant `document_id`). `after-switch`: once every app Deployment and StatefulSet has rolled out, for a rewrite of what the old writers still wrote (the step-1 renames). |
| `expires` | `drop after release YYYY-Www`: the contract deletes the directory with the legacy readers. |

Every backfill is idempotent: on dev and prod every registered backfill runs on
every deploy, and almost every run finds 0.

## What the deploy does

Pulumi creates one Job per phase that has a backfill
(`deploy/pulumi/src/app/backfills.ts`), `app-backfill-before` and
`app-backfill-after`, on both projects. Each registered backfill is one init
container, in name order, so they run one after another:

- **SQL** in `postgres:17-alpine`, as the owner the migrate Job uses
  (`APP_MIGRATION_DATABASE_URL`), with `statement_timeout=0` and
  `lock_timeout=30s`, through [`run-sql.sh`](../../apps/workspace/backfills/run-sql.sh):
  dry run, apply, dry run again.
- **Qdrant** in the backend image with `QDRANT_URL` and `QDRANT_API_KEY`:
  `command`, `command --apply`, `command --check`. Its pods carry
  `app.kubernetes.io/name: app-backfill`, which the Qdrant network policy admits.

The Job runs again whenever the image tag or a registered file changes, so on
every deploy. Pulumi awaits it (65 minutes at most; `activeDeadlineSeconds` 60
minutes). A count above 0 after the apply fails the container, the Job (one
retry), and so the deploy: a failed `before-readers` backfill stops the rollout
before any new reader starts; a failed `after-switch` one leaves the release
rolled out and the deploy red.

Each run logs JSON lines, which reach PostHog Logs through the log shipper. The
shipper keeps every line of an `app-backfill-*` pod; it samples other info lines
at 10%:

```json
{"event":"backfill.count","backfill":"inbox-types","phase":"after-switch","store":"inbox_items.type","before":185,"written":185,"after":0}
{"event":"backfill.done","backfill":"inbox-types","phase":"after-switch","before":185,"written":185,"after":0}
```

A Qdrant backfill logs one `backfill.count` line per collection and step, with
`mode` `dry-run`, `apply` or `check`. `backfill.failed` names what was left.

## What CI checks

- `scripts/rls-test-db.sh` runs every registered SQL backfill twice through
  `run-sql.sh` against the migrated schema with every suite's rows: each ends at
  0, and the second run writes nothing. The step-1 backfills also run against
  seeded legacy rows, and their first run must write.
- `packages/knowledge-layer/tests/test_registered_qdrant_backfills.py` runs
  every registered Qdrant backfill's three steps twice against a real Qdrant,
  with legacy points, and checks that `--check` fails while one is left.
- `deploy/pulumi/index-backfills.spec.ts`: the order above, the owner
  credential, one container per registered backfill, and that a failure is
  awaited.
