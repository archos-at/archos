#!/usr/bin/env bash
# Stand up a throwaway Postgres, apply the full drizzle migration chain, and run
# the row-level-security isolation suite against it as `grid_app_rw` (ADR-0041).
#
# The suite has to run as the RESTRICTED role. Connecting as the owner would
# pass every assertion while proving nothing, because row-level security does
# not apply to a table's owner — so this script is the difference between the
# tests meaning something and merely appearing to.
#
# Everything lives under a temporary directory and is torn down on exit; no
# existing cluster is touched.
set -euo pipefail

UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/workspace" && pwd)"
REPO_ROOT="$(cd "$UI_DIR/../.." && pwd)"
# A port nobody holds, unless the caller names one. Parallel runs in one
# container (two agents, two worktrees) each get their own: a fixed default made
# the second die at `pg_ctl: could not start server` before any migration ran.
# TCP on 127.0.0.1 rather than the unix socket alone, because the vitest suites
# below connect to 127.0.0.1:$PORT. The OS picks an ephemeral port and the
# probe releases it; the window before `pg_ctl` binds it again is milliseconds.
PORT="${RLS_TEST_PORT:-$(node -e '
  const server = require("net").createServer();
  server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });
')}"
# `|| true` matters: under `set -e` a glob that matches nothing makes the
# substitution non-zero and kills the script here, so the friendly "install
# postgresql, or set PGBIN" message below would never be the thing an operator
# without server binaries actually sees.
PGBIN="${PGBIN:-$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)}"
WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/pgdata"
RUNTIME_PASSWORD="rls_test_pw"  # pragma: allowlist secret (throwaway cluster, destroyed on exit)

if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "error: no PostgreSQL server binaries found. Install postgresql, or set PGBIN." >&2
  exit 1
fi

cleanup() {
  # Through run_pg, not directly: pg_ctl refuses to run as root, and on a root
  # host the direct call failed under `|| true` while the rm -rf below deleted
  # the data directory out from under a server that kept running. (CI is
  # unprivileged, which is why it never showed there.) run_pg is defined after
  # this trap is armed, so the early exits above it fall back to the direct call.
  if declare -F run_pg >/dev/null; then
    run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m immediate stop" >/dev/null 2>&1 || true
  else
    "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# initdb refuses to run as root, which is normal in CI containers; fall back to
# the `postgres` system user when there is one.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  if id postgres >/dev/null 2>&1; then
    RUNAS="postgres"
    # The unix socket is created in WORKDIR (-k), so that directory has to be
    # writable by the dropped-to user too, not just PGDATA.
    mkdir -p "$PGDATA"
    chown "$RUNAS" "$WORKDIR" "$PGDATA"
    chmod 755 "$WORKDIR"
  else
    echo "error: running as root and no 'postgres' user exists to drop to." >&2
    exit 1
  fi
fi
run_pg() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else sh -c "$1"; fi; }

echo "==> $("$PGBIN/postgres" --version)"
echo "==> initialising a throwaway cluster on port $PORT"
run_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust" >/dev/null
run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -o '-p $PORT -k $WORKDIR' -l '$PGDATA/server.log' -w start" >/dev/null

# NOTICEs from the idempotent DROP ... IF EXISTS guards are expected noise.
export PGOPTIONS="-c client_min_messages=warning"
PSQL="$PGBIN/psql -h $WORKDIR -p $PORT -U postgres"

# `--exec <command…>`: the same throwaway cluster, without the migration chain or
# the suites below, for the Python suites whose Postgres branch would otherwise
# skip (`task be:test:postgres`). They create and drop their own tables, so they
# get an empty scratch database as the superuser, in TEST_POSTGRES_URL.
if [ "${1:-}" = "--exec" ]; then
  shift
  $PSQL -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE aiq_queues;"
  echo "==> running: $*"
  TEST_POSTGRES_URL="postgresql://postgres@127.0.0.1:$PORT/aiq_queues" "$@"
  exit 0
fi

# Reproduce the DEPLOYMENT topology, not a convenient one. Migrations run as a
# plain non-superuser database owner with no CREATEROLE and no BYPASSRLS —
# exactly what CloudNativePG hands the app. Running this chain as `postgres`
# instead is why an earlier version of the migration shipped a CREATE ROLE that
# could never have executed on Kubernetes.
echo "==> provisioning roles (a deployment concern, not a migration one)"
$PSQL -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE grid_app_owner LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;" \
  -c "CREATE ROLE grid_app_platform NOLOGIN BYPASSRLS;" \
  -c "CREATE ROLE grid_app_rw LOGIN NOINHERIT PASSWORD '$RUNTIME_PASSWORD';" \
  -c "GRANT grid_app_platform TO grid_app_rw;" \
  -c "CREATE DATABASE grid_app OWNER grid_app_owner;"

echo "==> applying the migration chain as grid_app_owner (no CREATEROLE, no BYPASSRLS)"
cd "$UI_DIR"
MIGRATE="$PGBIN/psql -h $WORKDIR -p $PORT -U grid_app_owner -d grid_app"
node -e '
  const j = require("./migrations/meta/_journal.json");
  console.log(j.entries.map((e) => e.tag).join("\n"));
' | while read -r tag; do
  $MIGRATE -v ON_ERROR_STOP=1 -q -f "migrations/$tag.sql" >/dev/null || {
    echo "MIGRATION FAILED at $tag — re-run without -q to see the error" >&2
    exit 1
  }
done

# The deploy renames the row-level-security roles once the migrations have run
# (ADR-0145 row 10d): the migrations written before the rename grant to their
# old names, which is why the chain above ran under those. The app steps up to
# the NEW platform name, so the suites run after the same rename the deploy
# does, with the deploy's own script. The per-migration checks further down
# replay old migrations into fresh databases, so they get the old names back.
RLS_RENAMES="grid_app_owner:app_owner grid_app_platform:app_platform grid_app_rw:app_rw"
OWNER=grid_app_owner  # the schema owner's current name, for the helpers below
rename_rls_roles() {
  PATH="$PGBIN:$PATH" PGHOST="$WORKDIR" PGPORT="$PORT" PGUSER=postgres RUNTIME_PASSWORD="$RUNTIME_PASSWORD" \
    sh "$REPO_ROOT/deploy/postgres/rename-legacy-names.sh" after-migrate >/dev/null
  OWNER=app_owner
}
restore_rls_role_names() {
  local pair
  for pair in $RLS_RENAMES; do
    $PSQL -q -v ON_ERROR_STOP=1 -c "ALTER ROLE ${pair#*:} RENAME TO ${pair%%:*};"
  done
  $PSQL -q -v ON_ERROR_STOP=1 -c "ALTER ROLE grid_app_rw PASSWORD '$RUNTIME_PASSWORD';"
  OWNER=grid_app_owner
}

# `--only <spec…>`: the migrated cluster and the restricted role, for the specs
# named and nothing else. For one suite while you work on it, and for the
# measurements that are not part of the gate (`task workspace:search:latency`). The
# owner's URL is passed too, for a measurement that has to ANALYZE its seed:
# the runtime role may not, and production's statistics are autovacuum's.
if [ "${1:-}" = "--only" ]; then
  shift
  rename_rls_roles
  echo "==> running $* as app_rw"
  TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  TEST_OWNER_DATABASE_URL="postgres://app_owner@127.0.0.1:$PORT/grid_app" \
    npx vitest run "$@"
  exit 0
fi

# Every suite here needs the same cluster and the same restricted role. The BIM
# and memory ones are here rather than in the unit shards because every claim
# they make is a claim about SQL — jsonb property filters, grouped aggregates,
# the element-to-model tenancy join, "one fact, one live row" through a raw
# cosine query — and a mocked drizzle handle cannot disagree with the fixture
# that mocked it. (The memory suite is the one that found the semantic gate
# reading `.rows` off a postgres-js array, which every mock had agreed with.)
# The inbound mail and mail thread suites (ADR-0137) are named here before
# their files exist, one per package that writes one: the repository (D7, D8),
# the sweeps (D12), the review-first ratchet (D9), append (D9), follow (D10)
# and the archive (D11). A name vitest finds no file for filters nothing, and
# `integration-suite-coverage.spec.ts` fails a spec that lands under any other
# name, so a suite cannot arrive here unrun.
echo "==> renaming the row-level-security roles as the deploy does, after the migrations"
rename_rls_roles
# Site resolution: alone and first. It asserts that no territory record holds a
# Gemeinde yet (no_territory), and the platform suite in the batch below releases
# that territory; in one batch whichever ran first decided the outcome (seen
# 2026-11-10 once the batch's timing moved).
echo "==> running the site-resolution suite as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run bff/site-resolution/site-resolution.integration.spec.ts
echo "==> running the isolation, BIM query, memory consolidation, profile-binding, legal-hold, chat-erasure, restricted-use, cross-project use, similar passages, project intake, run-reconciler, usage-ledger, answer-feedback, restricted memory, download-log, Papierkorb, closed-project, Steckbrief, Ausmisten, upload batches, quarantine decisions, the agent's proposed operations and solo reads, restricted-feedback, revision-subject, the hold on a document, permit-record, push subscription, inbox paging, Anmerkungen, Offene Punkte, folder cards and search providers, workspace search, inbound mail and mail thread suites as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run \
    bff/db/tenant-isolation.integration.spec.ts \
    bff/bim/query.integration.spec.ts \
    bff/bim/extraction-repository.integration.spec.ts \
    bff/bim/model-shelf.integration.spec.ts \
    bff/bim/model-kinds-repository.integration.spec.ts \
    bff/projects/memory-service.integration.spec.ts \
    bff/projects/memory-restricted.integration.spec.ts \
    bff/documents/document-versions.integration.spec.ts \
    bff/documents/list-page.integration.spec.ts \
    bff/documents/quarantine-listing.integration.spec.ts \
    bff/documents/visibility.integration.spec.ts \
    bff/documents/local-work-ownership.integration.spec.ts \
    bff/upload-batches/upload-batches.integration.spec.ts \
    bff/authz/folder-access.integration.spec.ts \
    bff/projects/collection-placement.integration.spec.ts \
    bff/projects/folder-visibility.integration.spec.ts \
    bff/documents/shelf-folders.integration.spec.ts \
    bff/projects/folder-bin.integration.spec.ts \
    bff/documents/stuck-processing.integration.spec.ts \
    bff/documents/retry-policy.integration.spec.ts \
    bff/project-profile/profile-bindings.integration.spec.ts \
    bff/compliance/legal-hold.integration.spec.ts \
    bff/conversations/erasure-queue.integration.spec.ts \
    bff/scheduling/conversation-trace-erasure.integration.spec.ts \
    bff/conversations/restricted-use.integration.spec.ts \
    bff/feedback/restricted-feedback.integration.spec.ts \
    bff/tasks/subject-access.integration.spec.ts \
    bff/tasks/active-runs.integration.spec.ts \
    bff/conversations/cross-project-use.integration.spec.ts \
    bff/cross-project/decisions-repository.integration.spec.ts \
    bff/similar-passages/service.integration.spec.ts \
    bff/permits/repository.integration.spec.ts \
    bff/annotations/repository.integration.spec.ts \
    bff/annotations/project-repository.integration.spec.ts \
    bff/proposals/repository.integration.spec.ts \
    bff/agent-api/operation-proposals.integration.spec.ts \
    bff/agent-api/read-gate.integration.spec.ts \
    bff/project-intake/repository.integration.spec.ts \
    bff/changes/repository.integration.spec.ts \
    bff/push/repository.integration.spec.ts \
    bff/agent-asks/repository.integration.spec.ts \
    bff/residency/processing-policy.integration.spec.ts \
    bff/inbox/repository.integration.spec.ts \
    bff/project-experience/readable-files.integration.spec.ts \
    bff/projects/memory-evidence.integration.spec.ts \
    bff/download-log/download-log.integration.spec.ts \
    bff/runs/reconcile.integration.spec.ts \
    bff/budgets/service.integration.spec.ts \
    bff/analytics/usage-export-repository.integration.spec.ts \
    bff/feedback/repository.integration.spec.ts \
    bff/citations/repository.integration.spec.ts \
    bff/profiler/repository.integration.spec.ts \
    bff/projects/project-status.integration.spec.ts \
    bff/projects/project-record.integration.spec.ts \
    bff/projects/cleanup.integration.spec.ts \
    bff/feedback/repository.integration.spec.ts \
    bff/filing/root-sort-run-repository.integration.spec.ts \
    bff/folder-cards/repository.integration.spec.ts \
    bff/estate-tree/repository.integration.spec.ts \
    bff/mail-import/repository.integration.spec.ts \
    bff/search/providers.integration.spec.ts \
    bff/search/document-repository.integration.spec.ts \
    bff/inbound-mail/repository.integration.spec.ts \
    bff/inbound-mail/sweep.integration.spec.ts \
    bff/inbound-mail/review-first.e2e.spec.ts \
    bff/mail-thread/append.integration.spec.ts \
    bff/mail-thread/follow.integration.spec.ts \
    bff/mail-thread/archive.integration.spec.ts \
    bff/base-knowledge/store/repository.integration.spec.ts \
    bff/base-knowledge/store/rulesets.integration.spec.ts \
    bff/base-knowledge/platform/platform.integration.spec.ts \
    bff/base-knowledge/platform/approve-alone.integration.spec.ts \
    bff/base-knowledge/platform/texts.integration.spec.ts \
    bff/base-knowledge/platform/organization-countries.integration.spec.ts

# Editions in time: alone, after the platform suite, since both release
# Austria's territory and a release over one moved since a request was opened
# is a 409 by design. In one batch the two raced, and whichever opened its
# request first lost (seen 2026-11-10 once a file joined the batch).
echo "==> running the editions-in-time suite as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run bff/base-knowledge/time/time.integration.spec.ts

# The onboarding door (ADR-0170): a scripted client takes AT-9 through the
# platform door to a stable release. Alone and after the platform suite, since
# both release Austria's territories and a release over one moved since a
# request was opened is a 409 by design.
echo "==> running the onboarding door suite as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run bff/agent-api/onboarding-door.integration.spec.ts

# The onboarding tooling (ADR-0174): a scripted client onboards the synthetic
# country XA (a source record, its testing hosts, an advice policy, counsel's
# approval) and the source monitor opens a change request when the source changes.
echo "==> running the synthetic country suite as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run bff/agent-api/synthetic-country-door.integration.spec.ts

# A source whose documents are PDFs (ADR-0174 amendment): a pdf_document source
# record, a real public PDF captured through it, and a quote from its page 2
# that passes KC-6. Its own synthetic country (XP), so it shares no territory.
echo "==> running the PDF source suite as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
  npx vitest run bff/agent-api/pdf-source-door.integration.spec.ts

# The tenant suites above may leave queued jobs behind: Ausmisten bins a
# subfolder, and a Papierkorb delete queues its purge takeover and a refused
# one its restore. The job-queue suites claim from the whole table and expect
# only their own seeds, so they start from an empty one.
$PSQL -d grid_app -v ON_ERROR_STOP=1 -q -c "DELETE FROM bff_job_queue" >/dev/null

# The job-queue suites take and sweep ONE table, whichever lane a job is in, so
# run in parallel they take each other's seeded jobs. One file at a time. The
# scheduler's due-scan is the same shape over task_definitions, every tenant's.
# `orchestrator.integration.spec.ts` also needs an engine (HATCHET_CLIENT_TOKEN and
# HATCHET_CLIENT_HOST_PORT, CI's hatchet-lite); without one it skips.
# The country-pack suite publishes Austria's real territory ids, which the
# platform suite above publishes too: alone, so neither publish meets the other's.
# The visibility suite reads the owner's URL to check the office predicate with
# the row policy bypassed (`store/visibility.ts`).
echo "==> running the job-queue and scheduling suites one file at a time as app_rw"
TEST_DATABASE_URL="postgres://app_rw:$RUNTIME_PASSWORD@127.0.0.1:$PORT/grid_app" \
TEST_OWNER_DATABASE_URL="postgres://app_owner@127.0.0.1:$PORT/grid_app" \
  npx vitest run --no-file-parallelism \
    bff/jobs-queue/repository.integration.spec.ts \
    bff/jobs-queue/task-run.integration.spec.ts \
    bff/jobs-queue/orchestrator.integration.spec.ts \
    bff/scheduling/repository.integration.spec.ts \
    bff/base-knowledge/chain/chain.integration.spec.ts \
    bff/base-knowledge/store/visibility.integration.spec.ts \
    bff/base-knowledge/golden/golden-run.integration.spec.ts

# A function, a table and a view created by a superuser (a restore, a hand-run
# script) are what made `ALTER FUNCTION … RENAME` in migration 0190 fail on
# production with `42501 must be owner of function`. The deploy's superuser step
# hands them to the migration role before migrate; prove the migration role
# cannot rename one before, and can after.
echo "==> a superuser-owned object no longer stops a migration (ownership normalized before migrate)"
$PSQL -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE grid_ownership OWNER $OWNER;"
$PSQL -q -v ON_ERROR_STOP=1 -d grid_ownership \
  -c "CREATE FUNCTION public.grid_stranger() RETURNS int LANGUAGE sql AS 'SELECT 1'" \
  -c "CREATE TABLE public.stranger_table (id serial PRIMARY KEY)" \
  -c "CREATE VIEW public.stranger_view AS SELECT 1 AS one"
OWNER_PSQL="$PGBIN/psql -h $WORKDIR -p $PORT -U $OWNER -d grid_ownership -v ON_ERROR_STOP=1 -q"
if $OWNER_PSQL -c "ALTER FUNCTION public.grid_stranger() RENAME TO stranger" 2>/dev/null; then
  echo "OWNERSHIP SETUP FAILED: the migration role renamed a function it does not own" >&2
  exit 1
fi
normalize_ownership() {
  PATH="$PGBIN:$PATH" PGHOST="$WORKDIR" PGPORT="$PORT" PGUSER=postgres OWNER_ROLE="$OWNER" OWNER_DATABASE=grid_ownership \
    sh "$REPO_ROOT/deploy/postgres/rename-legacy-names.sh" normalize-ownership
}
normalize_ownership
normalize_ownership # idempotent
$OWNER_PSQL -c "ALTER FUNCTION public.grid_stranger() RENAME TO stranger" \
  -c "ALTER TABLE public.stranger_table RENAME TO stranger_renamed" \
  -c "ALTER VIEW public.stranger_view RENAME TO stranger_view_renamed" || {
  echo "OWNERSHIP NOT NORMALIZED: the migration role still cannot rename what a superuser created" >&2
  exit 1
}
strangers=$($PSQL -d grid_ownership -tAc "SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','S') AND r.rolname = 'postgres'")
if [ "$strangers" != "0" ]; then
  echo "OWNERSHIP NOT NORMALIZED: $strangers relation(s) in public still belong to postgres" >&2
  exit 1
fi
$PSQL -q -c "DROP DATABASE grid_ownership;"

# Everything below re-proves one migration of the chain at a time: a database
# migrated to just before it, seeded with the old shapes, checked row by row,
# then taken down. Those claims read nothing but apps/workspace/migrations/ and this
# script, and they are ~60% of this script's time. CI's Plan sets
# RLS_MIGRATION_CHECKS=0 when neither changed (the `migrations` tier in
# .github/filters.yml); unset, as locally, they run.
echo "==> the old role names again, for the migrations replayed below"
restore_rls_role_names

if [ "${RLS_MIGRATION_CHECKS:-1}" = "0" ]; then
  echo "==> per-migration backfill and down checks skipped: no migration and not this script changed"
  exit 0
fi

# ---------------------------------------------------------------------------
# The migration sections below each check one migration on a database of its
# own, migrated to exactly the point that migration follows.
#
# Replaying the journal into every one of them cost each section the whole
# chain again: about 90 of the run's 150 seconds, and growing with every
# migration twice over, once for the longer chain and once for its own section.
# Instead the chain is applied ONCE, into `grid_chain`, a template that only
# moves forward, and each section clones it (`CREATE DATABASE ... TEMPLATE`),
# which copies the files rather than re-running the SQL. A clone is the same
# database the replay produced: the migrations set nothing at database level,
# the one thing a template does not carry. A section that asks for an earlier
# point than the template holds gets a template rebuilt from scratch.
#
# `migrate_until <db> <tag>` gives <db> the journal up to and including <tag>,
# `migrate_before <db> <tag>` up to the migration before it.
# ---------------------------------------------------------------------------
JOURNAL=()
while read -r tag; do JOURNAL+=("$tag"); done < <(node -e '
  const j = require("./migrations/meta/_journal.json");
  console.log(j.entries.map((e) => e.tag).join("\n"));
')
CHAIN_AT=-1  # index in JOURNAL of the last migration grid_chain holds; -1 = no grid_chain

journal_index() {
  local i
  for i in "${!JOURNAL[@]}"; do
    if [ "${JOURNAL[$i]}" = "$1" ]; then echo "$i"; return; fi
  done
  echo "$1 is not in the journal" >&2
  exit 1
}
# Clone grid_chain, advanced to JOURNAL[<index>], as <db>.
clone_chain_at() {
  local db="$1" target="$2" i
  if [ "$target" -lt "$CHAIN_AT" ]; then
    $PSQL -q -v ON_ERROR_STOP=1 -c "DROP DATABASE grid_chain;"
    CHAIN_AT=-1
  fi
  if [ "$CHAIN_AT" -lt 0 ]; then
    $PSQL -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE grid_chain OWNER grid_app_owner;"
  fi
  for ((i = CHAIN_AT + 1; i <= target; i++)); do
    $PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_chain -v ON_ERROR_STOP=1 -q \
      -f "migrations/${JOURNAL[$i]}.sql" >/dev/null || {
      echo "SETUP OF $db FAILED at ${JOURNAL[$i]} — re-run without -q to see the error" >&2
      exit 1
    }
    CHAIN_AT=$i
  done
  $PSQL -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db TEMPLATE grid_chain OWNER grid_app_owner;"
}
migrate_until() {
  local at
  at=$(journal_index "$2")
  clone_chain_at "$1" "$at"
}
migrate_before() {
  local at
  at=$(journal_index "$2")
  clone_chain_at "$1" "$((at - 1))"
}

# ---------------------------------------------------------------------------
# Migrations up to 0132 have run in production for more than a week, so their
# backfills and down migrations are history: their sections are gone, and the
# git log keeps them. What stays below 0133 is what those migrations put into
# the database that it still refuses today and that no suite above covers: a
# CHECK, a unique index or a guard trigger, each on a clone of the chain taken
# at the migration that created it.
#
# `check_in` and `refused_in` assert against that database as its owner, which
# is what runs a migration.
# ---------------------------------------------------------------------------
# Run a migration file (or its down) against <db>, failing loudly.
apply_in() {
  $PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d "$1" -v ON_ERROR_STOP=1 -q -f "migrations/$2" >/dev/null || {
    echo "MIGRATION $2 FAILED on $1 — re-run without -q to see the error" >&2
    exit 1
  }
}
sql_in() { $PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d "$1" -v ON_ERROR_STOP=1 -q >/dev/null; }
check_in() {
  local got
  got=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d "$1" -tAc "$2")
  if [ "$got" != "$3" ]; then
    echo "MIGRATION ASSERTION FAILED on $1: $4" >&2
    echo "  query: $2" >&2
    echo "  got:   $got" >&2
    echo "  want:  $3" >&2
    exit 1
  fi
}
# Run SQL that must be REFUSED on <db>, and check the refusal names the rule ($3).
refused_in() {
  local out
  if out=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d "$1" -v ON_ERROR_STOP=1 -q 2>&1 <<<"$2"); then
    echo "MIGRATION ASSERTION FAILED on $1: $4 (the statement was accepted)" >&2
    exit 1
  fi
  if ! grep -q -- "$3" <<<"$out"; then
    echo "MIGRATION ASSERTION FAILED on $1: $4 (refused for another reason)" >&2
    echo "  output: $out" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Migration 0111: a folder's own list (ADR-0088). The list's people moved to
# WorkOS in 0128; the CHECKs on a grant and on a custom folder stayed.
# ---------------------------------------------------------------------------
echo "==> verifying the 0111 grant and folder constraints on grid_grants"
migrate_until grid_grants 0111_project_folder_grants
sql_in grid_grants <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000106', 'org_0106', 'Grants 0110', 'user_1', 'proj_0106');
BEGIN;
INSERT INTO project_folders (id, organization_id, project_id, name, path, access_mode, access_changed_by, access_changed_at) VALUES
  ('a1a1a1a1-a1a1-4000-8000-000000000106', 'org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'Verträge', 'Verträge', 'custom', 'user_1', now());
INSERT INTO project_folders (id, organization_id, project_id, name, path) VALUES
  ('c3c3c3c3-c3c3-4000-8000-000000000106', 'org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'Pläne', 'Pläne');
INSERT INTO project_folder_grants (organization_id, project_id, folder_id, role_slug, level) VALUES
  ('org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'a1a1a1a1-a1a1-4000-8000-000000000106', 'org-gf', 'write');
COMMIT;
SQL
refused_in grid_grants "INSERT INTO project_folder_grants (organization_id, project_id, folder_id, role_slug, level) VALUES ('org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'a1a1a1a1-a1a1-4000-8000-000000000106', 'org-pl', 'admin');" "project_folder_grants_level_check" "a level is read or write"
refused_in grid_grants "INSERT INTO project_folder_grants (organization_id, project_id, folder_id, role_slug, level) VALUES ('org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'a1a1a1a1-a1a1-4000-8000-000000000106', '*org', 'read');" "project_folder_grants_role_check" "a slug never starts with the reserved *"
refused_in grid_grants "UPDATE project_folders SET access_changed_by = NULL WHERE id = 'a1a1a1a1-a1a1-4000-8000-000000000106';" "project_folders_access_custom_check" "a custom folder says who set its list"
refused_in grid_grants "INSERT INTO project_folders (organization_id, project_id, name, path) VALUES ('org_0106', 'aaaaaaaa-0000-4000-8000-000000000106', 'Pläne', 'Pläne');" "uniq_project_folders_parent_name" "two living folders cannot share a name"
echo "==> 0111 grant and folder constraints verified"

# ---------------------------------------------------------------------------
# Migration 0112: the per-folder chat record. `last_at` never before
# `first_at`, and no foreign keys: a row may precede its conversation. The
# admission and read paths are proved against the real chain by
# restricted-use.integration.spec.ts above.
# ---------------------------------------------------------------------------
echo "==> verifying the 0112 chat record on grid_chat_folders"
migrate_until grid_chat_folders 0112_conversation_restricted_folders
refused_in grid_chat_folders "INSERT INTO conversation_restricted_folders (organization_id, conversation_id, folder_id, first_at, last_at) VALUES ('org_0107', 's_1', gen_random_uuid(), now(), now() - interval '1 minute');" "conversation_restricted_folders_order" "last_at never comes before first_at"
sql_in grid_chat_folders <<'SQL'
INSERT INTO conversation_restricted_folders (organization_id, conversation_id, folder_id)
VALUES ('org_0107', 's_never_created', 'a1a1a1a1-a1a1-4000-8000-000000000107');
SQL
check_in grid_chat_folders "SELECT count(*) FROM conversation_restricted_folders" "1" "a row needs no conversation row yet and no folder row (no foreign keys)"
echo "==> 0112 chat record verified"

# ---------------------------------------------------------------------------
# Migration 0113: restricted memory by folder. An open and a restricted note
# with the same text can both be live (the dedup index); an empty folder list
# and a restricted organization note are refused (the CHECK).
# ---------------------------------------------------------------------------
echo "==> verifying the 0113 restricted memory on grid_memory"
migrate_until grid_memory 0113_project_memory_restricted_folders
sql_in grid_memory <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000108', 'org_0108', 'Memory 0112', 'user_1', 'proj_0108');
INSERT INTO project_memory (scope, project_id, organization_id, kind, content, restricted_folder_ids) VALUES
  ('project', 'aaaaaaaa-0000-4000-8000-000000000108', 'org_0108', 'decision', 'Honorar pauschal', NULL),
  ('project', 'aaaaaaaa-0000-4000-8000-000000000108', 'org_0108', 'decision', 'Honorar pauschal', ARRAY['d4d4d4d4-d4d4-4000-8000-000000000108'::uuid]);
SQL
check_in grid_memory "SELECT count(*) FROM project_memory WHERE organization_id = 'org_0108' AND status = 'active'" "2" "an open and a restricted note with the same text are both live"
refused_in grid_memory "INSERT INTO project_memory (scope, project_id, organization_id, kind, content) VALUES ('project', 'aaaaaaaa-0000-4000-8000-000000000108', 'org_0108', 'decision', 'Honorar pauschal');" "uniq_project_memory_project_content_active" "a second open note with the same text is still one too many"
refused_in grid_memory "INSERT INTO project_memory (scope, project_id, organization_id, kind, content, restricted_folder_ids) VALUES ('project', 'aaaaaaaa-0000-4000-8000-000000000108', 'org_0108', 'decision', 'leer', '{}');" "project_memory_restricted_folders_check" "an empty folder list is not a restriction"
refused_in grid_memory "INSERT INTO project_memory (scope, organization_id, kind, content, restricted_folder_ids) VALUES ('organization', 'org_0108', 'decision', 'Büroweit', ARRAY['d4d4d4d4-d4d4-4000-8000-000000000108'::uuid]);" "project_memory_restricted_folders_check" "organization memory is never restricted"
echo "==> 0113 restricted memory verified"

# ---------------------------------------------------------------------------
# Migration 0115: the Papierkorb's triggers and CHECK. Nothing is filed into a
# deleted folder, a document or a subfolder; an Archiv folder (no project, no
# bin lock) takes a document; a living folder cannot be purged and an Archiv
# folder cannot be deleted in place, since the Archiv has no Papierkorb. The
# folder is deleted before 0115 runs, the only way to seed one with no bin entry.
# ---------------------------------------------------------------------------
echo "==> verifying the 0115 Papierkorb triggers and CHECK on grid_bin"
migrate_until grid_bin 0114_document_access_log
sql_in grid_bin <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000110', 'org_0110', 'Papierkorb 0114', 'user_1', 'proj_0110');
INSERT INTO project_folders (id, organization_id, project_id, name, path, deleted_at, deleted_by) VALUES
  ('e1e1e1e1-e1e1-4000-8000-000000000110', 'org_0110', 'aaaaaaaa-0000-4000-8000-000000000110', 'Ablage 0114', 'Ablage 0114', '2026-10-01T08:00:00Z', 'user_1');
INSERT INTO project_folders (id, organization_id, project_id, name, path) VALUES
  ('e2e2e2e2-e2e2-4000-8000-000000000110', 'org_0110', 'aaaaaaaa-0000-4000-8000-000000000110', 'Plaene 0114', 'Plaene 0114');
INSERT INTO project_folders (id, organization_id, scope, name, path) VALUES
  ('e3e3e3e3-e3e3-4000-8000-000000000110', 'org_0110', 'archiv', 'Normen 0114', 'Normen 0114');
SQL
apply_in grid_bin 0115_folder_bin.sql
refused_in grid_bin "INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id) VALUES ('org_0110', 'user_1', 'spaet.pdf', 'k/spaet', 'proj_0110', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000110', 'e1e1e1e1-e1e1-4000-8000-000000000110');" "is deleted; nothing may be filed into it" "a document cannot be filed into a deleted folder"
refused_in grid_bin "INSERT INTO project_folders (organization_id, project_id, parent_id, name, path) VALUES ('org_0110', 'aaaaaaaa-0000-4000-8000-000000000110', 'e1e1e1e1-e1e1-4000-8000-000000000110', 'Neu', 'Ablage 0114/Neu');" "is deleted; nothing may be filed into it" "a folder cannot be created under a deleted folder"
refused_in grid_bin "UPDATE project_folders SET purged_at = now() WHERE id = 'e2e2e2e2-e2e2-4000-8000-000000000110';" "project_folders_bin_state_check" "a living folder cannot be purged"
refused_in grid_bin "UPDATE project_folders SET deleted_at = now(), deleted_by = 'user_1' WHERE id = 'e3e3e3e3-e3e3-4000-8000-000000000110';" "project_folders_bin_state_check" "an Archiv folder has no Papierkorb and no tombstone"
sql_in grid_bin <<<"INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, folder_id) VALUES ('org_0110', 'user_1', 'norm.pdf', 'k/norm', 'archiv_org_0110', 'completed', 'archiv', 'e3e3e3e3-e3e3-4000-8000-000000000110');"
check_in grid_bin "SELECT count(*) FROM documents WHERE folder_id = 'e3e3e3e3-e3e3-4000-8000-000000000110'" "1" "an Archiv folder takes a document: the trigger takes no bin lock for it"
echo "==> 0115 Papierkorb triggers and CHECK verified"

# ---------------------------------------------------------------------------
# Migration 0119: the content gate's quarantine decisions, owed to the audit
# trail (ADR-0086). The repository's claims (one decision per dispatch, owed
# until marked once, outliving the document, deleted once spent by the platform
# role alone) are proved through the runtime role by
# upload-batches.integration.spec.ts above; here, what the database itself
# refuses.
# ---------------------------------------------------------------------------
echo "==> verifying the 0119 quarantine decisions and their guard on grid_quarantine"
migrate_until grid_quarantine 0119_document_quarantine_decisions
sql_in grid_quarantine <<<"INSERT INTO document_quarantine_decisions (id, organization_id, document_id, job_id, scope, filename, uploaded_by) VALUES ('f1f1f1f1-f1f1-4000-8000-000000000117', 'org_0117', 'f2f2f2f2-f2f2-4000-8000-000000000117', 'job-1', 'archiv', 'Lohn.pdf', 'u');"
refused_in grid_quarantine "INSERT INTO document_quarantine_decisions (organization_id, document_id, job_id, scope, filename, uploaded_by) VALUES ('org_0117', 'f2f2f2f2-f2f2-4000-8000-000000000117', 'job-1', 'archiv', 'Lohn.pdf', 'u');" "document_quarantine_decisions_dispatch_key" "one dispatch is one decision"
refused_in grid_quarantine "INSERT INTO document_quarantine_decisions (organization_id, document_id, job_id, scope, filename, uploaded_by) VALUES ('org_0117', gen_random_uuid(), 'job-1', 'project', 'x', 'u');" "document_quarantine_decisions_scope_project" "a project shelf needs a project"
refused_in grid_quarantine "UPDATE document_quarantine_decisions SET reasons = 'iban' WHERE id = 'f1f1f1f1-f1f1-4000-8000-000000000117';" "only marked audited once" "a decision is never rewritten"
sql_in grid_quarantine <<<"UPDATE document_quarantine_decisions SET audited_at = now() WHERE id = 'f1f1f1f1-f1f1-4000-8000-000000000117';"
refused_in grid_quarantine "UPDATE document_quarantine_decisions SET audited_at = now() WHERE id = 'f1f1f1f1-f1f1-4000-8000-000000000117';" "only marked audited once" "a decision is marked audited once"
refused_in grid_quarantine "DELETE FROM document_quarantine_decisions;" "deleted only by the platform role" "only the platform role deletes"
echo "==> 0119 quarantine decisions verified"

# ---------------------------------------------------------------------------
# Migrations 0125 and 0127: a cross-project record cannot end before it began,
# and the evidence a drafted decision was read from (ADR-0096) is an array when
# it is set.
# ---------------------------------------------------------------------------
echo "==> verifying the 0125 cross-project record and the 0127 memory evidence CHECKs on grid_cross_project"
migrate_until grid_cross_project 0127_project_memory_evidence
sql_in grid_cross_project <<'SQL'
INSERT INTO conversation_source_projects (organization_id, conversation_id, project_id)
VALUES ('org_0125', 's_xp_0125', 'aaaaaaaa-0000-4000-8000-000000000125');
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000127', 'org_0127', 'Evidenz', 'user_1', 'proj_0127');
INSERT INTO project_memory (scope, project_id, organization_id, kind, content, provenance_type, verification, evidence)
VALUES ('project', 'aaaaaaaa-0000-4000-8000-000000000127', 'org_0127', 'decision', 'Fassade hinterlüftet 0127', 'distillation', 'source_grounded',
        '[{"fileName": "Baubeschreibung.pdf", "page": "4"}]');
SQL
refused_in grid_cross_project "UPDATE conversation_source_projects SET last_at = first_at - interval '1 day' WHERE conversation_id = 's_xp_0125';" "conversation_source_projects_order" "a record cannot end before it began"
refused_in grid_cross_project "UPDATE project_memory SET evidence = '{\"fileName\": \"a.pdf\"}' WHERE organization_id = 'org_0127';" "project_memory_evidence_check" "evidence is an array when it is set"
echo "==> 0125 and 0127 CHECKs verified"

# ---------------------------------------------------------------------------
# Migration 0129: the lifecycle state machine (ADR-0098), on the fully migrated
# database as the owner. A closed project keeps its Abschluss and a known
# outcome, a reopen keeps both for the next close, and a paused project still
# takes an insert; only a closed one refuses. project-status.integration.spec.ts
# above covers the rest of the CHECKs and the closed-project guard.
# ---------------------------------------------------------------------------
echo "==> verifying the 0129 project lifecycle on grid_app"
P129="id = 'aaaaaaaa-0000-4000-8000-000000000129'"
sql_in grid_app <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name, started_on)
VALUES ('aaaaaaaa-0000-4000-8000-000000000129', 'org_0129', 'Lifecycle 0129', 'user_1', 'proj_0129', '2031-03-01');
UPDATE projects SET status = 'closed', closed_at = '2031-06-15T10:00:00Z', closed_by = 'user_1', closed_outcome = 'completed', ended_on = '2031-06-01'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000129';
SQL
refused_in grid_app "UPDATE projects SET ended_on = NULL WHERE $P129;" "projects_closed_outcome_check" "a closed project keeps its Abschluss"
refused_in grid_app "UPDATE projects SET closed_outcome = 'abandoned' WHERE $P129;" "projects_closed_outcome_check" "an outcome is completed or cancelled"
sql_in grid_app <<<"UPDATE projects SET status = 'active', closed_at = NULL, closed_by = NULL WHERE $P129;"
check_in grid_app "SELECT ended_on || ' ' || closed_outcome FROM projects WHERE $P129" "2031-06-01 completed" "a reopen keeps the Abschluss and the outcome for the next close"
refused_in grid_app "UPDATE projects SET status = 'paused' WHERE $P129;" "projects_paused_state_check" "a paused project carries its date"
sql_in grid_app <<<"UPDATE projects SET status = 'paused', paused_at = now() WHERE $P129;"
sql_in grid_app <<<"INSERT INTO project_folders (organization_id, project_id, name, path) VALUES ('org_0129', 'aaaaaaaa-0000-4000-8000-000000000129', 'Plaene', 'Plaene');"
sql_in grid_app <<<"DELETE FROM projects WHERE $P129;"
echo "==> 0129 project lifecycle verified"

# ---------------------------------------------------------------------------
# Migration 0133: a project's profile always has its four parts, and its DOWN.
#
# On a database of its own, migrated to 0132, where a project that never saved
# its intake still stores `{}` (the old default) and the close dialog's debrief
# crashed on `profile.facts`. The backfill gives every row the shape and keeps
# what is well-formed; the default is the empty profile; a hand-written `{}`
# or a part of the wrong type is refused. The down leaves the data.
# ---------------------------------------------------------------------------
echo "==> verifying the 0133 project profile shape and its down migration on grid_pshape"
migrate_until grid_pshape 0132_documents_folder_level_listing_idx
sql_in grid_pshape <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000133', 'org_0133', 'Nie erfasst', 'user_1', 'proj_0133a');
INSERT INTO projects (id, organization_id, name, created_by, collection_name, profile, profile_version) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000133', 'org_0133', 'Teilweise', 'user_1', 'proj_0133b',
   '{"facts":{"bundesland":{"value":"tirol"}},"unknowns":"kaputt","extra":1}', 4),
  ('cccccccc-0000-4000-8000-000000000133', 'org_0133', 'Kein Objekt', 'user_1', 'proj_0133c', '[]', 2);
SQL
check_in grid_pshape "SELECT profile::text FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000133'" "{}" \
  "before 0133 a project that never saved its intake stores {}"
apply_in grid_pshape 0133_project_profile_shape.sql
P133="SELECT profile::text || ' v' || profile_version FROM projects WHERE id ="
check_in grid_pshape "$P133 'aaaaaaaa-0000-4000-8000-000000000133'" \
  '{"facts": {}, "goals": {}, "unknowns": [], "assumptions": {}} v1' "the backfill gives a {} row the empty profile, version unchanged"
check_in grid_pshape "$P133 'bbbbbbbb-0000-4000-8000-000000000133'" \
  '{"extra": 1, "facts": {"bundesland": {"value": "tirol"}}, "goals": {}, "unknowns": [], "assumptions": {}} v4' \
  "the backfill keeps a well-formed part and another key, and replaces a part of the wrong type"
check_in grid_pshape "$P133 'cccccccc-0000-4000-8000-000000000133'" \
  '{"facts": {}, "goals": {}, "unknowns": [], "assumptions": {}} v2' "the backfill turns a non-object into the empty profile"
sql_in grid_pshape <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('dddddddd-0000-4000-8000-000000000133', 'org_0133', 'Neu', 'user_1', 'proj_0133d');
SQL
check_in grid_pshape "$P133 'dddddddd-0000-4000-8000-000000000133'" \
  '{"facts": {}, "goals": {}, "unknowns": [], "assumptions": {}} v1' "a new project gets the empty profile by default"
refused_in grid_pshape "UPDATE projects SET profile = '{}' WHERE id = 'dddddddd-0000-4000-8000-000000000133'" \
  "projects_profile_shape_check" "a hand-written {} was accepted"
refused_in grid_pshape "UPDATE projects SET profile = profile || '{\"unknowns\": {}}' WHERE id = 'dddddddd-0000-4000-8000-000000000133'" \
  "projects_profile_shape_check" "unknowns as an object was accepted"
refused_in grid_pshape "UPDATE projects SET profile = profile - 'goals' WHERE id = 'dddddddd-0000-4000-8000-000000000133'" \
  "projects_profile_shape_check" "a profile without goals was accepted"
apply_in grid_pshape 0133_project_profile_shape.down.sql
check_in grid_pshape "SELECT count(*) FROM pg_constraint WHERE conname = 'projects_profile_shape_check'" "0" "down dropped the check"
check_in grid_pshape "SELECT column_default FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'profile'" \
  "'{}'::jsonb" "down restored the old default"
check_in grid_pshape "$P133 'bbbbbbbb-0000-4000-8000-000000000133'" \
  '{"extra": 1, "facts": {"bundesland": {"value": "tirol"}}, "goals": {}, "unknowns": [], "assumptions": {}} v4' "down left the data"
sql_in grid_pshape <<<"UPDATE projects SET profile = '{}' WHERE id = 'dddddddd-0000-4000-8000-000000000133'"
apply_in grid_pshape 0133_project_profile_shape.sql
apply_in grid_pshape 0133_project_profile_shape.sql
check_in grid_pshape "SELECT count(*) FROM projects WHERE organization_id = 'org_0133' AND profile ? 'facts'" "4" \
  "0133 re-applies, twice, and backfills a {} written while it was down"
echo "==> 0133 project profile shape and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0137: a version knows how it began, and an upload carries no
# approval nobody gave (ADR-0104 rules 5 and 6), and its DOWN.
#
# On a database of its own, migrated to 0136. A version never submitted that is
# or was the published one is an upload and loses its stand-in approver; one
# that went through review keeps the reviewer's. Afterwards a published draft
# without an approver and an unknown origin are refused, and an upload is
# published with none. The down restores the stand-in approvals.
# ---------------------------------------------------------------------------
echo "==> verifying the 0137 version origin backfill and its down migration on grid_vorigin"
migrate_until grid_vorigin 0136_document_version_reviews
sql_in grid_vorigin <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000137', 'org_0137', 'Herkunft 0137', 'user_1', 'proj_0137');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000137', 'org_0137', 'user_1', 'a.pdf', 'k/0137/a2', 'proj_0137', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000137'),
  ('d2d2d2d2-0000-4000-8000-000000000137', 'org_0137', 'user_1', 'piloti/b.md', 'k/0137/b1', 'proj_0137', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000137'),
  ('d3d3d3d3-0000-4000-8000-000000000137', 'org_0137', 'user_1', 'piloti/c.md', 'k/0137/c1', 'proj_0137', 'stored', 'project', 'aaaaaaaa-0000-4000-8000-000000000137');
INSERT INTO document_versions (organization_id, document_id, project_id, version_number, state, storage_key, created_by,
                               submitted_by, submitted_at, approved_by, approved_at) VALUES
  -- a re-uploaded file: both versions carry the uploader as stand-in approver
  ('org_0137', 'd1d1d1d1-0000-4000-8000-000000000137', 'aaaaaaaa-0000-4000-8000-000000000137', 1, 'superseded', 'k/0137/a1', 'user_1', NULL, NULL, 'user_1', now()),
  ('org_0137', 'd1d1d1d1-0000-4000-8000-000000000137', 'aaaaaaaa-0000-4000-8000-000000000137', 2, 'published',  'k/0137/a2', 'user_1', NULL, NULL, 'user_1', now()),
  -- a Piloti document a reviewer approved
  ('org_0137', 'd2d2d2d2-0000-4000-8000-000000000137', 'aaaaaaaa-0000-4000-8000-000000000137', 1, 'published',  'k/0137/b1', 'user_1', 'user_1', now(), 'user_2', now()),
  -- a draft
  ('org_0137', 'd3d3d3d3-0000-4000-8000-000000000137', 'aaaaaaaa-0000-4000-8000-000000000137', 1, 'draft',      'k/0137/c1', 'user_1', NULL, NULL, NULL, NULL);
SQL
V137="SELECT string_agg(d.filename || ':' || v.version_number || '=' || v.origin || '/' || coalesce(v.approved_by, '-'), ',' ORDER BY d.filename, v.version_number) FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.organization_id = 'org_0137'"
apply_in grid_vorigin 0137_document_version_origin.sql
check_in grid_vorigin "$V137" "a.pdf:1=upload/-,a.pdf:2=upload/-,piloti/b.md:1=draft/user_2,piloti/c.md:1=draft/-" \
  "the backfill calls a never-submitted published version an upload and drops its stand-in approver, and keeps a reviewer's"
refused_in grid_vorigin "UPDATE document_versions SET state = 'published' WHERE document_id = 'd3d3d3d3-0000-4000-8000-000000000137'" \
  "document_versions_published_is_approved" "a draft was published without an approver"
refused_in grid_vorigin "UPDATE document_versions SET origin = 'import' WHERE document_id = 'd3d3d3d3-0000-4000-8000-000000000137'" \
  "document_versions_origin_known" "an unknown origin was accepted"
check_in grid_vorigin "SELECT column_default FROM information_schema.columns WHERE table_name = 'document_versions' AND column_name = 'origin'" \
  "'draft'::text" "a writer that names no origin gets the one that demands an approver"
apply_in grid_vorigin 0137_document_version_origin.down.sql
check_in grid_vorigin "SELECT count(*) FROM information_schema.columns WHERE table_name = 'document_versions' AND column_name = 'origin'" "0" "down dropped the column"
check_in grid_vorigin "SELECT count(*) FROM document_versions WHERE organization_id = 'org_0137' AND approved_by = created_by AND submitted_by IS NULL" "2" \
  "down restored the stand-in approvals the old CHECK demands"
apply_in grid_vorigin 0137_document_version_origin.sql
apply_in grid_vorigin 0137_document_version_origin.sql
check_in grid_vorigin "$V137" "a.pdf:1=upload/-,a.pdf:2=upload/-,piloti/b.md:1=draft/user_2,piloti/c.md:1=draft/-" "0137 re-applies, twice, to the same origins"
echo "==> 0137 version origin backfill and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0138: document_annotations and their replies, the CHECKs, and the
# DOWN.
#
# On a database of its own, migrated to 0137. A point is a share of the page
# and a region stays on it; only Piloti proposes, and only a person takes a
# proposal over; a closing is by somebody at some time; a number is unique per
# document; a discarded version leaves the mark standing; a thread goes with
# its mark.
# ---------------------------------------------------------------------------
echo "==> verifying the 0138 Anmerkungen tables and their down migration on grid_annot"
migrate_until grid_annot 0137_document_version_origin
apply_in grid_annot 0138_document_annotations.sql
check_in grid_annot "SELECT string_agg(relrowsecurity::text, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('document_annotations', 'document_annotation_replies')" "true,true" "0138 brings both tables up under row-level security"
sql_in grid_annot <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000135', 'org_0135', 'Anmerkungen 0138', 'user_1', 'proj_0135');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000135', 'org_0135', 'user_1', 'a.pdf', 'k/0138/a', 'proj_0135', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000135');
INSERT INTO document_versions (id, organization_id, document_id, project_id, version_number, state, storage_key, content_hash, created_by, approved_by, approved_at)
VALUES ('e1e1e1e1-0000-4000-8000-000000000135', 'org_0135', 'd1d1d1d1-0000-4000-8000-000000000135', 'aaaaaaaa-0000-4000-8000-000000000135', 1, 'superseded', 'k/0138/a1', 'sha256:a1', 'user_1', 'user_1', now());
INSERT INTO document_annotations (id, organization_id, document_id, version_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000135', 'org_0135', 'd1d1d1d1-0000-4000-8000-000000000135', 'e1e1e1e1-0000-4000-8000-000000000135', 1, 2, 'point', 0.25, 0.75, 'defect', 'Brandschutztür fehlt', 'person', 'open', 'user_1');
INSERT INTO document_annotations (organization_id, document_id, number, page, shape, x, y, w, h, kind, body, basis, author_kind, status, created_by)
VALUES ('org_0135', 'd1d1d1d1-0000-4000-8000-000000000135', 2, 1, 'region', 0.1, 0.1, 0.5, 0.5, 'question', 'Laufbreite?', 'OIB-RL 4, Pkt. 2.2', 'piloti', 'proposed', 'user_1');
INSERT INTO document_annotation_replies (organization_id, annotation_id, author_kind, body, created_by)
VALUES ('org_0135', 'f1f1f1f1-0000-4000-8000-000000000135', 'person', 'Erledige ich', 'user_2');
SQL
A135="INSERT INTO document_annotations (organization_id, document_id, number, page, shape, x, y, w, h, kind, body, author_kind, status, created_by) VALUES ('org_0135', 'd1d1d1d1-0000-4000-8000-000000000135'"
refused_in grid_annot "$A135, 3, 1, 'point', 1.5, 0.5, NULL, NULL, 'hint', 'x', 'person', 'open', 'user_1')" "document_annotations_point_on_page" "a point off the page was accepted"
refused_in grid_annot "$A135, 3, 1, 'point', 0.5, 0.5, 0.1, 0.1, 'hint', 'x', 'person', 'open', 'user_1')" "document_annotations_region_on_page" "a point with a size was accepted"
refused_in grid_annot "$A135, 3, 1, 'region', 0.8, 0.5, 0.3, 0.1, 'hint', 'x', 'person', 'open', 'user_1')" "document_annotations_region_on_page" "a region off its page was accepted"
refused_in grid_annot "$A135, 3, 0, 'point', 0.5, 0.5, NULL, NULL, 'hint', 'x', 'person', 'open', 'user_1')" "document_annotations_page_positive" "page 0 was accepted"
refused_in grid_annot "$A135, 3, 1, 'point', 0.5, 0.5, NULL, NULL, 'todo', 'x', 'person', 'open', 'user_1')" "document_annotations_kind_known" "an unknown kind was accepted"
refused_in grid_annot "$A135, 3, 1, 'point', 0.5, 0.5, NULL, NULL, 'hint', '   ', 'person', 'open', 'user_1')" "document_annotations_body_length" "a blank body was accepted"
refused_in grid_annot "$A135, 3, 1, 'point', 0.5, 0.5, NULL, NULL, 'hint', 'x', 'person', 'proposed', 'user_1')" "document_annotations_only_piloti_proposes" "a person's proposal was accepted"
refused_in grid_annot "$A135, 3, 1, 'point', 0.5, 0.5, NULL, NULL, 'hint', 'x', 'piloti', 'open', 'user_1')" "document_annotations_piloti_needs_a_person" "Piloti's mark was born open"
refused_in grid_annot "$A135, 1, 1, 'point', 0.5, 0.5, NULL, NULL, 'hint', 'x', 'person', 'open', 'user_1')" "uniq_document_annotations_number" "a second number 1 was accepted"
refused_in grid_annot "UPDATE document_annotations SET status = 'resolved' WHERE number = 1" "document_annotations_closing_complete" "a closing by nobody was accepted"
refused_in grid_annot "UPDATE document_annotations SET status = 'open' WHERE number = 2" "document_annotations_piloti_needs_a_person" "a proposal was opened without a person taking it over"
sql_in grid_annot <<<"UPDATE document_annotations SET status = 'open', accepted_by = 'user_2', accepted_at = now() WHERE number = 2"
sql_in grid_annot <<<"UPDATE document_annotations SET status = 'resolved', closed_by = 'user_1', closed_at = now() WHERE number = 1"
sql_in grid_annot <<<"DELETE FROM document_versions WHERE id = 'e1e1e1e1-0000-4000-8000-000000000135'"
check_in grid_annot "SELECT string_agg(number || ':' || coalesce(version_id::text, 'null') || ':' || status, ',' ORDER BY number) FROM document_annotations" "1:null:resolved,2:null:open" "a discarded version leaves the mark standing, and a taken-over proposal is open"
sql_in grid_annot <<<"DELETE FROM document_annotations WHERE number = 1"
check_in grid_annot "SELECT count(*) FROM document_annotation_replies" "0" "a thread goes with its mark"
apply_in grid_annot 0138_document_annotations.down.sql
check_in grid_annot "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('document_annotations', 'document_annotation_replies')" "0" "down dropped both tables"
apply_in grid_annot 0138_document_annotations.sql
apply_in grid_annot 0138_document_annotations.sql
check_in grid_annot "SELECT count(*) FROM document_annotations" "0" "0138 re-applies, twice, empty"
echo "==> 0138 Anmerkungen tables and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0139: what wakes Piloti on an Anmerkung, the delegation to Piloti,
# the record of each wake, and the DOWN.
#
# On a database of its own, migrated to 0138. A reply says whether it
# addressed Piloti (false for every older reply); a delegation is both columns
# or neither, and only on an open mark; a wake record says why it started no
# turn exactly when it did not, and is settled exactly when it left `queued`;
# a wake goes with its mark.
# ---------------------------------------------------------------------------
echo "==> verifying the 0139 wake record, the delegation and their down migration on grid_wake"
migrate_until grid_wake 0138_document_annotations
sql_in grid_wake <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000136', 'org_0136', 'Wecken 0139', 'user_1', 'proj_0136');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000136', 'org_0136', 'user_1', 'a.pdf', 'k/0139/a', 'proj_0136', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000136');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000136', 'org_0136', 'd1d1d1d1-0000-4000-8000-000000000136', 1, 1, 'point', 0.5, 0.5, 'defect', 'Türbreite', 'person', 'open', 'user_1');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f2f2f2f2-0000-4000-8000-000000000136', 'org_0136', 'd1d1d1d1-0000-4000-8000-000000000136', 2, 1, 'point', 0.2, 0.2, 'question', 'Laufbreite?', 'piloti', 'proposed', 'user_1');
INSERT INTO document_annotation_replies (organization_id, annotation_id, author_kind, body, created_by)
VALUES ('org_0136', 'f1f1f1f1-0000-4000-8000-000000000136', 'person', 'Vor 0139 geschrieben', 'user_2');
SQL
apply_in grid_wake 0139_piloti_wakes.sql
check_in grid_wake "SELECT relrowsecurity FROM pg_class WHERE relname = 'piloti_wakes'" "t" "0139 brings the wake record up under row-level security"
check_in grid_wake "SELECT string_agg(addresses_agent::text, ',') FROM document_annotation_replies" "false" "a reply written before 0139 addressed nobody but people"
refused_in grid_wake "UPDATE document_annotations SET delegated_by = 'user_1' WHERE number = 1" "document_annotations_delegation_complete" "a delegation without its time was accepted"
refused_in grid_wake "UPDATE document_annotations SET delegated_at = now() WHERE number = 1" "document_annotations_delegation_complete" "a delegation without its person was accepted"
refused_in grid_wake "UPDATE document_annotations SET delegated_by = 'user_1', delegated_at = now() WHERE number = 2" "document_annotations_delegated_while_open" "a proposal was delegated to Piloti"
sql_in grid_wake <<<"UPDATE document_annotations SET delegated_by = 'user_1', delegated_at = now() WHERE number = 1"
refused_in grid_wake "UPDATE document_annotations SET status = 'resolved', closed_by = 'user_1', closed_at = now() WHERE number = 1" "document_annotations_delegated_while_open" "a mark closed with Piloti still working it"
sql_in grid_wake <<<"UPDATE document_annotations SET status = 'resolved', closed_by = 'user_1', closed_at = now(), delegated_by = NULL, delegated_at = NULL WHERE number = 1"
W136="INSERT INTO piloti_wakes (id, organization_id, document_id, annotation_id, trigger_kind, event_id, actor_user_id, status, reason, settled_at) VALUES (gen_random_uuid(), 'org_0136', 'd1d1d1d1-0000-4000-8000-000000000136', 'f2f2f2f2-0000-4000-8000-000000000136'"
refused_in grid_wake "$W136, 'shouted', 'e1', 'user_1', 'queued', NULL, NULL)" "piloti_wakes_trigger_known" "an unknown trigger was accepted"
refused_in grid_wake "$W136, 'thread_reply', 'e1', 'user_1', 'snoozed', NULL, now())" "piloti_wakes_status_known" "an unknown status was accepted"
refused_in grid_wake "$W136, 'thread_reply', 'e1', 'user_1', 'refused', NULL, now())" "piloti_wakes_reason_when_not_started" "a refused wake without its reason was accepted"
refused_in grid_wake "$W136, 'thread_reply', 'e1', 'user_1', 'started', 'weil', now())" "piloti_wakes_reason_when_not_started" "a started wake with a reason was accepted"
refused_in grid_wake "$W136, 'thread_reply', 'e1', 'user_1', 'started', NULL, NULL)" "piloti_wakes_settled_when_not_queued" "a started wake without its settling time was accepted"
refused_in grid_wake "$W136, 'thread_reply', 'e1', 'user_1', 'queued', NULL, now())" "piloti_wakes_settled_when_not_queued" "a queued wake with a settling time was accepted"
sql_in grid_wake <<<"$W136, 'thread_reply', 'e1', 'user_1', 'queued', NULL, NULL)"
sql_in grid_wake <<<"$W136, 'assigned', 'e2', 'user_1', 'suppressed', 'cap:mark-hour', now())"
check_in grid_wake "SELECT count(*) FROM piloti_wakes" "2" "a queued wake and a suppressed one with its reason are kept"
sql_in grid_wake <<<"DELETE FROM document_annotations WHERE number = 2"
check_in grid_wake "SELECT count(*) FROM piloti_wakes" "0" "a wake goes with its mark"
apply_in grid_wake 0139_piloti_wakes.down.sql
check_in grid_wake "SELECT count(*) FROM information_schema.tables WHERE table_name = 'piloti_wakes'" "0" "down dropped the wake record"
check_in grid_wake "SELECT count(*) FROM information_schema.columns WHERE (table_name, column_name) IN (('document_annotations', 'delegated_by'), ('document_annotations', 'delegated_at'), ('document_annotation_replies', 'addresses_agent'))" "0" "down dropped the three columns"
check_in grid_wake "SELECT count(*) FROM document_annotation_replies" "1" "down left the threads"
apply_in grid_wake 0139_piloti_wakes.sql
apply_in grid_wake 0139_piloti_wakes.sql
check_in grid_wake "SELECT count(*) FROM piloti_wakes" "0" "0139 re-applies, twice, empty"
echo "==> 0139 wake record, delegation and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0140: proposed_changes, the CHECKs, and the DOWN.
#
# On a database of its own, migrated to 0139. A proposal is decided by
# somebody at some time exactly when it left `proposed`; it carries results
# exactly when it was applied, as an array; the apply claim is both columns or
# neither, and only while it is still `proposed`; the project and the
# conversation are this organization's; it goes with either.
# ---------------------------------------------------------------------------
echo "==> verifying the 0140 proposed changes and their down migration on grid_prop"
migrate_until grid_prop 0139_piloti_wakes
apply_in grid_prop 0140_proposed_changes.sql
check_in grid_prop "SELECT relrowsecurity FROM pg_class WHERE relname = 'proposed_changes'" "t" "0140 brings proposed_changes up under row-level security"
sql_in grid_prop <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000137', 'org_0137', 'Vorschläge 0140', 'user_1', 'proj_0137'),
       ('bbbbbbbb-0000-4000-8000-000000000137', 'org_other', 'Fremd 0140', 'user_9', 'proj_other_0137');
INSERT INTO conversations (id, organization_id, created_by, project_id)
VALUES ('conv_0137', 'org_0137', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000137'),
       ('conv_other_0137', 'org_other', 'user_9', 'bbbbbbbb-0000-4000-8000-000000000137');
INSERT INTO proposed_changes (id, organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of, origin_conversation_id)
VALUES ('c1c1c1c1-0000-4000-8000-000000000137', 'org_0137', 'aaaaaaaa-0000-4000-8000-000000000137', 'file_operation',
        '{"operation":"move","operations":[{"document":"a.pdf","target_folder":"Einreichung"}]}', 'piloti', 'user_1', 'conv_0137'),
       ('c2c2c2c2-0000-4000-8000-000000000137', 'org_0137', 'aaaaaaaa-0000-4000-8000-000000000137', 'file_operation',
        '{"operation":"create_folder","operations":[{"folder_name":"Statik"}]}', 'piloti', 'user_1', NULL);
SQL
check_in grid_prop "SELECT string_agg(status, ',') FROM proposed_changes" "proposed,proposed" "a proposal is born proposed"
P137="INSERT INTO proposed_changes (organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of, origin_conversation_id, status, decided_by, decided_at, results, applying_by, applying_since) VALUES ('org_0137', 'aaaaaaaa-0000-4000-8000-000000000137'"
refused_in grid_prop "$P137, 'delete_all', '{}', 'piloti', 'user_1', NULL, 'proposed', NULL, NULL, NULL, NULL, NULL)" "proposed_changes_kind_known" "an unknown kind was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'withdrawn', 'user_1', now(), NULL, NULL, NULL)" "proposed_changes_status_known" "an unknown status was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'robot', 'user_1', NULL, 'proposed', NULL, NULL, NULL, NULL, NULL)" "proposed_changes_proposer_known" "an unknown proposer was accepted"
refused_in grid_prop "$P137, 'file_operation', '[]', 'piloti', 'user_1', NULL, 'proposed', NULL, NULL, NULL, NULL, NULL)" "proposed_changes_payload_object" "a payload that is not an object was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'dismissed', NULL, NULL, NULL, NULL, NULL)" "proposed_changes_decision_complete" "a decision by nobody was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'dismissed', 'user_1', NULL, NULL, NULL, NULL)" "proposed_changes_decision_complete" "a decision at no time was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'proposed', 'user_1', now(), NULL, NULL, NULL)" "proposed_changes_decision_complete" "an undecided proposal with a decider was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'applied', 'user_1', now(), NULL, NULL, NULL)" "proposed_changes_results_when_applied" "an applied proposal without results was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'dismissed', 'user_1', now(), '[]', NULL, NULL)" "proposed_changes_results_when_applied" "a dismissed proposal with results was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'failed', 'user_1', now(), '{}', NULL, NULL)" "proposed_changes_results_array" "results that are not a list were accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'proposed', NULL, NULL, NULL, 'user_1', NULL)" "proposed_changes_claim_complete" "a claim at no time was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', NULL, 'dismissed', 'user_1', now(), NULL, 'user_1', now())" "proposed_changes_claim_while_proposed" "a claim on a decided proposal was accepted"
refused_in grid_prop "$P137, 'file_operation', '{}', 'piloti', 'user_1', 'conv_other_0137', 'proposed', NULL, NULL, NULL, NULL, NULL)" "proposed_changes_conversation_fkey" "another organization's conversation was accepted"
refused_in grid_prop "INSERT INTO proposed_changes (organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0137', 'bbbbbbbb-0000-4000-8000-000000000137', 'file_operation', '{}', 'piloti', 'user_1')" "proposed_changes_project_fkey" "another organization's project was accepted"
sql_in grid_prop <<<"UPDATE proposed_changes SET applying_by = 'user_2', applying_since = now() WHERE id = 'c1c1c1c1-0000-4000-8000-000000000137'"
refused_in grid_prop "UPDATE proposed_changes SET status = 'partially_applied', decided_by = 'user_2', decided_at = now(), results = '[{\"label\":\"a.pdf\",\"ok\":true}]' WHERE id = 'c1c1c1c1-0000-4000-8000-000000000137'" "proposed_changes_claim_while_proposed" "a settle that kept its claim was accepted"
sql_in grid_prop <<<"UPDATE proposed_changes SET status = 'partially_applied', decided_by = 'user_2', decided_at = now(), results = '[{\"label\":\"a.pdf\",\"ok\":true}]', applying_by = NULL, applying_since = NULL WHERE id = 'c1c1c1c1-0000-4000-8000-000000000137'"
sql_in grid_prop <<<"DELETE FROM conversations WHERE id = 'conv_0137'"
check_in grid_prop "SELECT count(*) FROM proposed_changes" "1" "a proposal goes with its conversation"
sql_in grid_prop <<<"DELETE FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000137'"
check_in grid_prop "SELECT count(*) FROM proposed_changes" "0" "a proposal goes with its project"
apply_in grid_prop 0140_proposed_changes.down.sql
check_in grid_prop "SELECT count(*) FROM information_schema.tables WHERE table_name = 'proposed_changes'" "0" "down dropped proposed_changes"
check_in grid_prop "SELECT count(*) FROM conversations" "1" "down left the conversations"
apply_in grid_prop 0140_proposed_changes.sql
apply_in grid_prop 0140_proposed_changes.sql
check_in grid_prop "SELECT count(*) FROM proposed_changes" "0" "0140 re-applies, twice, empty"
echo "==> 0140 proposed changes and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0141: a wake's END, and the DOWN.
#
# On a database of its own, migrated to 0140. A wake has an end exactly when it
# has its final word (not `queued`, not `started`); the rows 0139 settled
# already ended when they settled; `answered` and `stopped` carry no reason,
# `failed` does.
# ---------------------------------------------------------------------------
echo "==> verifying the 0141 wake ends and their down migration on grid_wend"
migrate_until grid_wend 0140_proposed_changes
sql_in grid_wend <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000138', 'org_0138', 'Enden 0141', 'user_1', 'proj_0138');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000138', 'org_0138', 'user_1', 'a.pdf', 'k/0141/a', 'proj_0138', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000138');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 1, 1, 'point', 0.5, 0.5, 'defect', 'Türbreite', 'person', 'open', 'user_1');
INSERT INTO piloti_wakes (id, organization_id, document_id, annotation_id, trigger_kind, event_id, actor_user_id, status, reason, settled_at)
VALUES ('a1a1a1a1-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 'f1f1f1f1-0000-4000-8000-000000000138', 'thread_mention', 'e1', 'user_1', 'queued', NULL, NULL),
       ('a2a2a2a2-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 'f1f1f1f1-0000-4000-8000-000000000138', 'thread_mention', 'e2', 'user_1', 'started', NULL, now()),
       ('a3a3a3a3-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 'f1f1f1f1-0000-4000-8000-000000000138', 'assigned', 'e3', 'user_1', 'suppressed', 'cap:mark-hour', now());
SQL
apply_in grid_wend 0141_wake_ends.sql
check_in grid_wend "SELECT string_agg(status || ':' || (ended_at IS NOT NULL)::text, ',' ORDER BY event_id) FROM piloti_wakes" "queued:false,started:false,suppressed:true" "a wake 0139 settled without a turn ended when it settled; the others have not ended"
refused_in grid_wend "UPDATE piloti_wakes SET status = 'answered' WHERE event_id = 'e2'" "piloti_wakes_ended_when_final" "an answered wake without its end was accepted"
refused_in grid_wend "UPDATE piloti_wakes SET ended_at = now() WHERE event_id = 'e2'" "piloti_wakes_ended_when_final" "a running wake with an end was accepted"
refused_in grid_wend "UPDATE piloti_wakes SET status = 'snoozed', ended_at = now() WHERE event_id = 'e2'" "piloti_wakes_status_known" "an unknown end was accepted"
refused_in grid_wend "UPDATE piloti_wakes SET status = 'answered', ended_at = now(), reason = 'weil' WHERE event_id = 'e2'" "piloti_wakes_reason_when_not_started" "an answered wake with a reason was accepted"
refused_in grid_wend "UPDATE piloti_wakes SET status = 'failed', ended_at = now() WHERE event_id = 'e2'" "piloti_wakes_reason_when_not_started" "a failed turn without its reason was accepted"
sql_in grid_wend <<<"UPDATE piloti_wakes SET status = 'failed', reason = 'turn error', ended_at = settled_at + interval '1 minute' WHERE event_id = 'e2'"
sql_in grid_wend <<'SQL'
INSERT INTO piloti_wakes (id, organization_id, document_id, annotation_id, trigger_kind, event_id, actor_user_id, status, reason, settled_at, ended_at)
VALUES ('a4a4a4a4-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 'f1f1f1f1-0000-4000-8000-000000000138', 'thread_mention', 'e4', 'user_1', 'answered', NULL, now(), now() + interval '1 minute'),
       ('a5a5a5a5-0000-4000-8000-000000000138', 'org_0138', 'd1d1d1d1-0000-4000-8000-000000000138', 'f1f1f1f1-0000-4000-8000-000000000138', 'assigned', 'e5', 'user_1', 'stopped', NULL, now(), now() + interval '1 minute');
SQL
check_in grid_wend "SELECT count(*) FROM piloti_wakes WHERE ended_at IS NOT NULL" "4" "an answered, a stopped and a failed turn keep their ends"
apply_in grid_wend 0141_wake_ends.down.sql
check_in grid_wend "SELECT string_agg(status, ',' ORDER BY event_id) FROM piloti_wakes" "queued,started,suppressed,started,started" "down folds every end of a turn that ran back into started"
check_in grid_wend "SELECT count(*) FROM information_schema.columns WHERE table_name = 'piloti_wakes' AND column_name = 'ended_at'" "0" "down dropped ended_at"
apply_in grid_wend 0141_wake_ends.sql
apply_in grid_wend 0141_wake_ends.sql
check_in grid_wend "SELECT count(*) FROM piloti_wakes WHERE ended_at IS NOT NULL" "1" "0141 re-applies, twice: only the suppressed wake has ended"
echo "==> 0141 wake ends and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0142: piloti_changes, the CHECKs, and the DOWN.
#
# On a database of its own, migrated to 0141. A change names a known object
# and op; a create has no before, a delete no after, an update both; a reply
# is only ever created; a mark's change names the mark as its object; states
# are objects; an undo is by somebody at some time; the document and the
# conversation are this organization's; it goes with either, and outlives the
# mark it deleted.
# ---------------------------------------------------------------------------
echo "==> verifying the 0142 change record and its down migration on grid_chg"
migrate_until grid_chg 0141_wake_ends
apply_in grid_chg 0142_piloti_changes.sql
check_in grid_chg "SELECT relrowsecurity FROM pg_class WHERE relname = 'piloti_changes'" "t" "0142 brings piloti_changes up under row-level security"
sql_in grid_chg <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000139', 'org_0139', 'Änderungen 0142', 'user_1', 'proj_0139'),
       ('bbbbbbbb-0000-4000-8000-000000000139', 'org_other', 'Fremd 0142', 'user_9', 'proj_other_0139');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000139', 'org_0139', 'user_1', 'a.pdf', 'k/0142/a', 'proj_0139', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000139'),
       ('d2d2d2d2-0000-4000-8000-000000000139', 'org_0139', 'user_1', 'b.pdf', 'k/0142/b', 'proj_0139', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000139');
INSERT INTO conversations (id, organization_id, created_by, project_id)
VALUES ('conv_0139', 'org_0139', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000139'),
       ('conv_other_0139', 'org_other', 'user_9', 'bbbbbbbb-0000-4000-8000-000000000139');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000139', 'org_0139', 'd1d1d1d1-0000-4000-8000-000000000139', 1, 1, 'point', 0.5, 0.5, 'defect', 'Türbreite', 'person', 'open', 'user_1');
INSERT INTO piloti_changes (organization_id, document_id, annotation_id, object_kind, object_id, op, before, after, origin_conversation_id, origin_message_id, on_behalf_of)
VALUES ('org_0139', 'd1d1d1d1-0000-4000-8000-000000000139', 'f1f1f1f1-0000-4000-8000-000000000139', 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', '{"status":"open"}', '{"status":"resolved"}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1'),
       ('org_0139', 'd1d1d1d1-0000-4000-8000-000000000139', 'f1f1f1f1-0000-4000-8000-000000000139', 'annotation_reply', 'e1e1e1e1-0000-4000-8000-000000000139', 'create', NULL, '{"body":"Ja."}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1'),
       ('org_0139', 'd2d2d2d2-0000-4000-8000-000000000139', 'f2f2f2f2-0000-4000-8000-000000000139', 'annotation', 'f2f2f2f2-0000-4000-8000-000000000139', 'delete', '{"status":"open","body":"weg"}', NULL, 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1');
SQL
check_in grid_chg "SELECT count(*) FROM piloti_changes WHERE undone_at IS NULL AND undone_by IS NULL" "3" "an update, a reply and a delete of a mark that no longer exists are recorded, undone by nobody"
C139="INSERT INTO piloti_changes (organization_id, document_id, annotation_id, object_kind, object_id, op, before, after, origin_conversation_id, origin_message_id, on_behalf_of) VALUES ('org_0139', 'd1d1d1d1-0000-4000-8000-000000000139', 'f1f1f1f1-0000-4000-8000-000000000139'"
refused_in grid_chg "$C139, 'document', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_object_known" "an unknown object was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'move', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_op_known" "an unknown op was accepted"
refused_in grid_chg "$C139, 'annotation_reply', 'e1e1e1e1-0000-4000-8000-000000000139', 'update', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_reply_is_created" "a reply changed by Piloti was accepted"
refused_in grid_chg "$C139, 'annotation', 'e1e1e1e1-0000-4000-8000-000000000139', 'update', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_annotation_is_object" "a mark's change naming another object was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'create', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_states_by_op" "a create with a before was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', NULL, '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_states_by_op" "an update without a before was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'delete', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_states_by_op" "a delete with an after was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', '[]', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_states_are_objects" "a state that is not an object was accepted"
refused_in grid_chg "$C139, 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', '{}', '{}', 'conv_other_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_conversation_fkey" "another organization's conversation was accepted"
refused_in grid_chg "INSERT INTO piloti_changes (organization_id, document_id, annotation_id, object_kind, object_id, op, before, after, origin_conversation_id, origin_message_id, on_behalf_of) VALUES ('org_0139', '00000000-0000-4000-8000-000000000139', 'f1f1f1f1-0000-4000-8000-000000000139', 'annotation', 'f1f1f1f1-0000-4000-8000-000000000139', 'update', '{}', '{}', 'conv_0139', 'c1c1c1c1-0000-4000-8000-000000000139', 'user_1')" "piloti_changes_document_fkey" "a change on no document was accepted"
refused_in grid_chg "UPDATE piloti_changes SET undone_at = now() WHERE op = 'update'" "piloti_changes_undo_complete" "an undo by nobody was accepted"
refused_in grid_chg "UPDATE piloti_changes SET undone_by = 'user_2' WHERE op = 'update'" "piloti_changes_undo_complete" "an undo at no time was accepted"
sql_in grid_chg <<<"UPDATE piloti_changes SET undone_at = now(), undone_by = 'user_2' WHERE op = 'update'"
sql_in grid_chg <<<"DELETE FROM document_annotations WHERE id = 'f1f1f1f1-0000-4000-8000-000000000139'"
check_in grid_chg "SELECT count(*) FROM piloti_changes" "3" "the record outlives the mark (no foreign key on the mark)"
sql_in grid_chg <<<"DELETE FROM documents WHERE id = 'd2d2d2d2-0000-4000-8000-000000000139'"
check_in grid_chg "SELECT count(*) FROM piloti_changes" "2" "a change goes with its document"
sql_in grid_chg <<<"DELETE FROM conversations WHERE id = 'conv_0139'"
check_in grid_chg "SELECT count(*) FROM piloti_changes" "0" "a change goes with the conversation of its turn"
apply_in grid_chg 0142_piloti_changes.down.sql
check_in grid_chg "SELECT count(*) FROM information_schema.tables WHERE table_name = 'piloti_changes'" "0" "down dropped piloti_changes"
check_in grid_chg "SELECT count(*) FROM documents" "1" "down left the documents"
apply_in grid_chg 0142_piloti_changes.sql
apply_in grid_chg 0142_piloti_changes.sql
check_in grid_chg "SELECT count(*) FROM piloti_changes" "0" "0142 re-applies, twice, empty"
echo "==> 0142 change record and down migration verified"


# ---------------------------------------------------------------------------
# Migration 0143: two more proposal kinds, the card index, and the DOWN.
#
# On a database of its own, migrated to 0142. A memory note and a profile
# change are stored, an unknown kind is not; a card index is never negative and
# names a card of an answer, so it needs the answer; one card of one answer is
# one proposal per organization, while another card, another answer, another
# organization or no card at all is its own. The down deletes the new kinds,
# forgets the card index, and the up re-applies twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0143 proposal kinds and their down migration on grid_kinds"
migrate_until grid_kinds 0142_piloti_changes
apply_in grid_kinds 0143_proposal_kinds.sql
sql_in grid_kinds <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000140', 'org_0140', 'Vorschläge 0143', 'user_1', 'proj_0140'),
       ('bbbbbbbb-0000-4000-8000-000000000140', 'org_other', 'Fremd 0143', 'user_9', 'proj_other_0140');
INSERT INTO proposed_changes (id, organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of, origin_message_id, origin_card_index)
VALUES ('c1c1c1c1-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'file_operation',
        '{"operation":"create_folder","operations":[{"folder_name":"Statik"}]}', 'piloti', 'user_1', NULL, NULL),
       ('c2c2c2c2-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'memory',
        '{"scope":"project","kind":"decision","content":"Flachdach","confidence":"high"}', 'piloti', 'user_1',
        'dddddddd-0000-4000-8000-000000000140', 0),
       ('c3c3c3c3-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'project_profile',
        '{"title":"Bundesland","patch":[{"op":"replace","path":"/facts/bundesland/value","value":"tirol"}]}', 'piloti', 'user_1',
        'dddddddd-0000-4000-8000-000000000140', 1),
       ('c4c4c4c4-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'memory',
        '{"scope":"organization","kind":"preference","content":"1:100","confidence":"medium"}', 'piloti', 'user_1',
        'dddddddd-0000-4000-8000-000000000140', NULL),
       ('c5c5c5c5-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'memory',
        '{"scope":"organization","kind":"preference","content":"1:50","confidence":"medium"}', 'piloti', 'user_1',
        'dddddddd-0000-4000-8000-000000000140', NULL),
       ('c6c6c6c6-0000-4000-8000-000000000140', 'org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'memory',
        '{"scope":"project","kind":"decision","content":"Holzbau","confidence":"high"}', 'piloti', 'user_1',
        'eeeeeeee-0000-4000-8000-000000000140', 0),
       ('c7c7c7c7-0000-4000-8000-000000000140', 'org_other', 'bbbbbbbb-0000-4000-8000-000000000140', 'memory',
        '{"scope":"project","kind":"decision","content":"Fremd","confidence":"low"}', 'piloti', 'user_9',
        'dddddddd-0000-4000-8000-000000000140', 0);
SQL
check_in grid_kinds "SELECT string_agg(kind, ',' ORDER BY id) FROM proposed_changes" "file_operation,memory,project_profile,memory,memory,memory,memory" "0143 stores both new kinds, a card on another answer, two without a card, and the same card in another organization"
P140="INSERT INTO proposed_changes (organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of, origin_message_id, origin_card_index) VALUES ('org_0140', 'aaaaaaaa-0000-4000-8000-000000000140'"
refused_in grid_kinds "$P140, 'steckbrief', '{}', 'piloti', 'user_1', NULL, NULL)" "proposed_changes_kind_known" "an unknown kind was accepted"
refused_in grid_kinds "$P140, 'memory', '{}', 'piloti', 'user_1', 'dddddddd-0000-4000-8000-000000000140', -1)" "proposed_changes_card_index_nonnegative" "a negative card index was accepted"
refused_in grid_kinds "$P140, 'memory', '{}', 'piloti', 'user_1', NULL, 2)" "proposed_changes_card_index_needs_message" "a card index without its answer was accepted"
refused_in grid_kinds "$P140, 'project_profile', '{}', 'piloti', 'user_1', 'dddddddd-0000-4000-8000-000000000140', 0)" "uniq_proposed_changes_origin_card" "the same card of the same answer was accepted twice"
refused_in grid_kinds "UPDATE proposed_changes SET origin_card_index = 1 WHERE id = 'c2c2c2c2-0000-4000-8000-000000000140'" "uniq_proposed_changes_origin_card" "a proposal was moved onto another proposal's card"
# The service's idempotent insert: the same card is no row, and the first one reads back.
sql_in grid_kinds <<<"$P140, 'memory', '{}', 'piloti', 'user_1', 'dddddddd-0000-4000-8000-000000000140', 0) ON CONFLICT (organization_id, origin_message_id, origin_card_index) WHERE origin_card_index IS NOT NULL DO NOTHING"
check_in grid_kinds "SELECT count(*) FROM proposed_changes WHERE organization_id = 'org_0140'" "6" "an insert of a card already proposed added a row"
apply_in grid_kinds 0143_proposal_kinds.down.sql
check_in grid_kinds "SELECT string_agg(kind, ',') FROM proposed_changes" "file_operation" "down deleted the proposals of the new kinds, and only those"
check_in grid_kinds "SELECT count(*) FROM information_schema.columns WHERE table_name = 'proposed_changes' AND column_name = 'origin_card_index'" "0" "down dropped the card index"
check_in grid_kinds "SELECT count(*) FROM pg_indexes WHERE indexname = 'uniq_proposed_changes_origin_card'" "0" "down dropped the card's unique index"
refused_in grid_kinds "INSERT INTO proposed_changes (organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0140', 'aaaaaaaa-0000-4000-8000-000000000140', 'memory', '{}', 'piloti', 'user_1')" "proposed_changes_kind_known" "down left the new kinds allowed"
apply_in grid_kinds 0143_proposal_kinds.sql
apply_in grid_kinds 0143_proposal_kinds.sql
check_in grid_kinds "SELECT count(*) FROM proposed_changes" "1" "0143 re-applies, twice, keeping the file operation"
sql_in grid_kinds <<<"$P140, 'memory', '{}', 'piloti', 'user_1', 'dddddddd-0000-4000-8000-000000000140', 0)"
refused_in grid_kinds "$P140, 'memory', '{}', 'piloti', 'user_1', 'dddddddd-0000-4000-8000-000000000140', 0)" "uniq_proposed_changes_origin_card" "the re-applied 0143 lost the card's unique index"
echo "==> 0143 proposal kinds and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0144: project_intakes, the CHECKs, and the DOWN.
#
# On a database of its own, migrated to 0143. One intake per project, of this
# organization's project, gone with it. A closing intent exactly in `closing`
# mode, and an object; a reading always names its job, and one job is one
# intake's; the completion is by somebody at some time exactly when
# `completed`; the read list and the dismissed values are arrays, born empty;
# the description is at most 500 characters.
# ---------------------------------------------------------------------------
echo "==> verifying the 0144 project intakes and their down migration on grid_intake"
migrate_until grid_intake 0143_proposal_kinds
apply_in grid_intake 0144_project_intakes.sql
check_in grid_intake "SELECT relrowsecurity FROM pg_class WHERE relname = 'project_intakes'" "t" "0144 brings project_intakes up under row-level security"
sql_in grid_intake <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000144', 'org_0144', 'Erfassung 0144', 'user_1', 'proj_0144'),
       ('cccccccc-0000-4000-8000-000000000144', 'org_0144', 'Abgeschlossen 0144', 'user_1', 'proj_closed_0144'),
       ('dddddddd-0000-4000-8000-000000000144', 'org_0144', 'Frei 0144', 'user_1', 'proj_free_0144'),
       ('bbbbbbbb-0000-4000-8000-000000000144', 'org_other', 'Fremd 0144', 'user_9', 'proj_other_0144');
INSERT INTO project_intakes (organization_id, project_id, created_by)
VALUES ('org_0144', 'aaaaaaaa-0000-4000-8000-000000000144', 'user_1');
INSERT INTO project_intakes (organization_id, project_id, created_by, mode, closing, status, job_id, requested_by)
VALUES ('org_0144', 'cccccccc-0000-4000-8000-000000000144', 'user_1', 'closing',
        '{"outcome":"completed","endedOn":"2024-06"}', 'reading', 'job_0144', 'user_1');
SQL
check_in grid_intake "SELECT string_agg(mode || ':' || status || ':' || documents_read::text || ':' || dismissed::text || ':' || rerun_requested::text, ',' ORDER BY mode) FROM project_intakes" "active:waiting:[]:[]:false,closing:reading:[]:[]:false" "an intake is born waiting and active, with nothing read or dismissed"
I144="INSERT INTO project_intakes (organization_id, project_id, created_by, mode, closing, status, job_id, completed_at, completed_by) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1'"
refused_in grid_intake "$I144, 'active', NULL, 'paused', NULL, NULL, NULL)" "project_intakes_status_known" "an unknown status was accepted"
refused_in grid_intake "$I144, 'archive', NULL, 'waiting', NULL, NULL, NULL)" "project_intakes_mode_known" "an unknown mode was accepted"
refused_in grid_intake "$I144, 'closing', NULL, 'waiting', NULL, NULL, NULL)" "project_intakes_closing_when_closing" "a closing intake without its intent was accepted"
refused_in grid_intake "$I144, 'active', '{\"outcome\":\"completed\",\"endedOn\":\"2024-06\"}', 'waiting', NULL, NULL, NULL)" "project_intakes_closing_when_closing" "an active intake with a closing intent was accepted"
refused_in grid_intake "$I144, 'closing', '[]', 'waiting', NULL, NULL, NULL)" "project_intakes_closing_object" "a closing intent that is not an object was accepted"
refused_in grid_intake "$I144, 'active', NULL, 'reading', NULL, NULL, NULL)" "project_intakes_job_when_reading" "a reading without its job was accepted"
refused_in grid_intake "$I144, 'active', NULL, 'completed', NULL, NULL, NULL)" "project_intakes_completion_complete" "a completion by nobody at no time was accepted"
refused_in grid_intake "$I144, 'active', NULL, 'completed', NULL, now(), NULL)" "project_intakes_completion_complete" "a completion by nobody was accepted"
refused_in grid_intake "$I144, 'active', NULL, 'ready', NULL, now(), 'user_1')" "project_intakes_completion_complete" "a completion on an intake still under review was accepted"
refused_in grid_intake "$I144, 'active', NULL, 'reading', 'job_0144', NULL, NULL)" "uniq_project_intakes_job" "one job reading for two intakes was accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by) VALUES ('org_0144', 'aaaaaaaa-0000-4000-8000-000000000144', 'user_1')" "uniq_project_intakes_project" "a second intake for one project was accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by) VALUES ('org_0144', 'bbbbbbbb-0000-4000-8000-000000000144', 'user_1')" "project_intakes_project_fkey" "another organization's project was accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by, documents_read) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1', '{}')" "project_intakes_documents_read_array" "a read list that is not a list was accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by, dismissed) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1', 'null')" "project_intakes_dismissed_array" "dismissed values that are not a list were accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by, location) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1', '\"Wien\"')" "project_intakes_location_object" "a location that is not an object was accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by, counts) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1', '[]')" "project_intakes_counts_object" "counts that are not an object were accepted"
refused_in grid_intake "INSERT INTO project_intakes (organization_id, project_id, created_by, description) VALUES ('org_0144', 'dddddddd-0000-4000-8000-000000000144', 'user_1', repeat('x', 501))" "project_intakes_description_length" "a description over 500 characters was accepted"
# A finished review: a reading that ends and is completed by somebody at some time.
sql_in grid_intake <<<"UPDATE project_intakes SET status = 'completed', completed_at = now(), completed_by = 'user_1' WHERE project_id = 'cccccccc-0000-4000-8000-000000000144'"
check_in grid_intake "SELECT status FROM project_intakes WHERE project_id = 'cccccccc-0000-4000-8000-000000000144'" "completed" "a review completes, keeping its last job"
sql_in grid_intake <<<"DELETE FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000144'"
check_in grid_intake "SELECT count(*) FROM project_intakes" "1" "an intake goes with its project"
apply_in grid_intake 0144_project_intakes.down.sql
check_in grid_intake "SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_intakes'" "0" "down dropped project_intakes"
check_in grid_intake "SELECT count(*) FROM projects WHERE organization_id = 'org_0144'" "2" "down left the projects"
apply_in grid_intake 0144_project_intakes.sql
apply_in grid_intake 0144_project_intakes.sql
check_in grid_intake "SELECT count(*) FROM project_intakes" "0" "0144 re-applies, twice, empty"
echo "==> 0144 project intakes and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0145: a folder's description, and the DOWN.
#
# On a database of its own, migrated to 0144. A folder on either shelf may say
# what belongs in it; a description is never blank and at most 500 characters.
# ---------------------------------------------------------------------------
echo "==> verifying the 0145 folder descriptions and their down migration on grid_fdesc"
migrate_until grid_fdesc 0144_project_intakes
sql_in grid_fdesc <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000145', 'org_0145', 'Ablage 0145', 'user_1', 'proj_0145');
INSERT INTO project_folders (id, organization_id, project_id, scope, name, path)
VALUES ('f1f1f1f1-0000-4000-8000-000000000145', 'org_0145', 'aaaaaaaa-0000-4000-8000-000000000145', 'project', 'Bescheide', 'Bescheide'),
       ('f2f2f2f2-0000-4000-8000-000000000145', 'org_0145', NULL, 'archiv', 'Normen', 'Normen');
SQL
apply_in grid_fdesc 0145_folder_descriptions.sql
check_in grid_fdesc "SELECT count(*) FROM project_folders WHERE description IS NULL" "2" "0145 leaves every folder undescribed"
sql_in grid_fdesc <<<"UPDATE project_folders SET description = 'Bescheide und Stellungnahmen der Behörden' WHERE name = 'Bescheide'"
sql_in grid_fdesc <<<"UPDATE project_folders SET description = 'ÖNORMEN, die das Büro gekauft hat' WHERE name = 'Normen'"
check_in grid_fdesc "SELECT count(*) FROM project_folders WHERE description IS NOT NULL" "2" "a project folder and a Büroablage folder each take a description"
refused_in grid_fdesc "UPDATE project_folders SET description = '   ' WHERE name = 'Bescheide'" "project_folders_description_length" "a blank description was accepted"
refused_in grid_fdesc "UPDATE project_folders SET description = '' WHERE name = 'Bescheide'" "project_folders_description_length" "an empty description was accepted"
refused_in grid_fdesc "UPDATE project_folders SET description = repeat('x', 501) WHERE name = 'Bescheide'" "project_folders_description_length" "a description over 500 characters was accepted"
apply_in grid_fdesc 0145_folder_descriptions.down.sql
check_in grid_fdesc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'project_folders' AND column_name = 'description'" "0" "down dropped the description"
check_in grid_fdesc "SELECT count(*) FROM project_folders" "2" "down kept the folders"
apply_in grid_fdesc 0145_folder_descriptions.sql
apply_in grid_fdesc 0145_folder_descriptions.sql
check_in grid_fdesc "SELECT count(*) FROM project_folders WHERE description IS NULL" "2" "0145 re-applies, twice"
echo "==> 0145 folder descriptions and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0146: proposals on the Büroablage, the trace, the CHECKs, the
# re-secured policy, and the DOWN.
#
# On a database of its own, migrated to 0145. A proposal is on a project
# exactly when it has one; a Büroablage proposal only moves Büroablage
# documents; the runtime role sees its own organization's Büroablage proposals
# and no other's.
# ---------------------------------------------------------------------------
echo "==> verifying the 0146 proposal shelves and their down migration on grid_pshelf"
migrate_until grid_pshelf 0145_folder_descriptions
sql_in grid_pshelf <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000146', 'org_0146', 'Ablage 0146', 'user_1', 'proj_0146');
INSERT INTO proposed_changes (id, organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of)
VALUES ('c1c1c1c1-0000-4000-8000-000000000146', 'org_0146', 'aaaaaaaa-0000-4000-8000-000000000146', 'file_operation',
        '{"operation":"move","operations":[{"document":"a.pdf","target_folder":"Bescheide"}]}', 'piloti', 'user_1');
SQL
apply_in grid_pshelf 0146_proposal_shelves.sql
check_in grid_pshelf "SELECT scope || ':' || (origin_trace_id IS NULL)::text FROM proposed_changes" "project:true" "0146 puts every existing proposal on its project's shelf"
sql_in grid_pshelf <<'SQL'
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of, origin_trace_id)
VALUES ('c2c2c2c2-0000-4000-8000-000000000146', 'org_0146', NULL, 'archiv', 'file_operation',
        '{"operation":"move","operations":[{"document":"Norm.pdf","source":"buero","target_folder":"Normen"}],"basis":"name"}', 'piloti', 'user_1', 'abcdef0123456789abcdef0123456789'),
       ('c3c3c3c3-0000-4000-8000-000000000146', 'org_other', NULL, 'archiv', 'file_operation',
        '{"operation":"move","operations":[{"document":"Fremd.pdf","source":"buero","target_folder":"Fremd"}]}', 'piloti', 'user_9', NULL);
SQL
check_in grid_pshelf "SELECT count(*) FROM proposed_changes WHERE scope = 'archiv'" "2" "a Büroablage move is stored without a project"
P146="INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0146'"
refused_in grid_pshelf "$P146, NULL, 'regal', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\",\"source\":\"buero\"}]}', 'piloti', 'user_1')" "proposed_changes_scope_known" "an unknown shelf was accepted"
refused_in grid_pshelf "$P146, NULL, 'project', 'file_operation', '{\"operation\":\"move\",\"operations\":[]}', 'piloti', 'user_1')" "proposed_changes_scope_owner" "a project proposal without its project was accepted"
refused_in grid_pshelf "$P146, 'aaaaaaaa-0000-4000-8000-000000000146', 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\",\"source\":\"buero\"}]}', 'piloti', 'user_1')" "proposed_changes_scope_owner" "a Büroablage proposal naming a project was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'memory', '{}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage proposal of another kind was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"create_folder\",\"operations\":[{\"folder_name\":\"X\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage proposal that is not a move was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\",\"source\":\"projekt\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage move of a project document was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage move of an item without its shelf was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\",\"source\":\"buero\"},{\"document\":\"b.pdf\",\"source\":\"projekt\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage move with one project item was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"move\"}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage move without items was accepted"
refused_in grid_pshelf "$P146, NULL, 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "a Büroablage move of no items was accepted"
check_in grid_pshelf "SELECT pg_get_expr(polqual, polrelid) LIKE '%project_id IS NULL%' FROM pg_policy WHERE polname = 'grid_tenant_isolation' AND polrelid = 'proposed_changes'::regclass" "t" "0146 re-secures proposed_changes with the Büroablage arm"
check_in grid_pshelf "SELECT count(*) FROM pg_policy WHERE polrelid = 'proposed_changes'::regclass" "1" "proposed_changes keeps exactly one policy"
# The runtime role, inside one tenant: its own Büroablage proposal, not the other organization's.
RW146=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_pshelf -qtA \
  -c "SET grid.organization_id = 'org_0146'" \
  -c "SELECT string_agg(id::text, ',' ORDER BY id) FROM proposed_changes WHERE scope = 'archiv'")
if [ "$RW146" != "c2c2c2c2-0000-4000-8000-000000000146" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_pshelf: the runtime role saw another organization's Büroablage proposal, or not its own (got: $RW146)" >&2
  exit 1
fi
apply_in grid_pshelf 0146_proposal_shelves.down.sql
check_in grid_pshelf "SELECT string_agg(id::text, ',') FROM proposed_changes" "c1c1c1c1-0000-4000-8000-000000000146" "down deleted the Büroablage proposals, and only those"
check_in grid_pshelf "SELECT count(*) FROM information_schema.columns WHERE table_name = 'proposed_changes' AND column_name IN ('scope', 'origin_trace_id')" "0" "down dropped the shelf and the trace"
refused_in grid_pshelf "INSERT INTO proposed_changes (organization_id, project_id, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0146', NULL, 'file_operation', '{}', 'piloti', 'user_1')" "null value" "down left the project optional"
apply_in grid_pshelf 0146_proposal_shelves.sql
apply_in grid_pshelf 0146_proposal_shelves.sql
check_in grid_pshelf "SELECT count(*) FROM proposed_changes" "1" "0146 re-applies, twice"
echo "==> 0146 proposal shelves and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0148: a held document's reason as a typed verdict (ADR-0113), and
# its DOWN. The backfill converts each quarantined row's `quarantined:` message
# row by row and leaves a row whose message does not parse NULL without
# stopping; the CHECKs hold the column to an object with a `reasons` array and
# to quarantined rows, so the release that ends a quarantine must clear it; a
# decision records how many reasons the job left out.
# ---------------------------------------------------------------------------
echo "==> verifying the 0148 quarantine verdict, its backfill and the down migration on grid_qverdict"
migrate_until grid_qverdict 0147_push_subscriptions
sql_in grid_qverdict <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000148', 'org_0148', 'Verdict 0148', 'user_1', 'proj_0148');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, content_hash, screening_outcome, error_message) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000148', 'org_0148', 'user_1', 'lohn.pdf', 'k/0148/lohn', 'proj_0148', 'quarantined', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'sha256:lohn', 'quarantined',
   'quarantined:{"reasons":[{"kind":"term","term":"Lohnzettel","count":2,"pages":[1,3]},{"kind":"iban","count":1,"pages":[2],"sample":"AT61 •••• •••• •••• 3201"}],"checked":"full","omitted":3}'),
  ('d2d2d2d2-0000-4000-8000-000000000148', 'org_0148', 'user_1', 'kaputt.pdf', 'k/0148/kaputt', 'proj_0148', 'quarantined', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'sha256:kaputt', 'quarantined',
   'quarantined:{not json'),
  ('d3d3d3d3-0000-4000-8000-000000000148', 'org_0148', 'user_1', 'form.pdf', 'k/0148/form', 'proj_0148', 'quarantined', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'sha256:form', 'quarantined',
   'quarantined:{"reasons":"none"}'),
  ('d4d4d4d4-0000-4000-8000-000000000148', 'org_0148', 'user_1', 'plan.pdf', 'k/0148/plan', 'proj_0148', 'failed', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'sha256:plan', NULL,
   'quarantined:{"reasons":[],"checked":"full"}'),
  ('d5d5d5d5-0000-4000-8000-000000000148', 'org_0148', 'user_1', 'brief.pdf', 'k/0148/brief', 'proj_0148', 'quarantined', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'sha256:brief', 'quarantined',
   NULL);
INSERT INTO document_quarantine_decisions (id, organization_id, document_id, job_id, scope, project_id, filename, reasons, uploaded_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000148', 'org_0148', 'd1d1d1d1-0000-4000-8000-000000000148', 'job-0148', 'project', 'aaaaaaaa-0000-4000-8000-000000000148', 'lohn.pdf', 'term:Lohnzettel,iban', 'user_1');
SQL
apply_in grid_qverdict 0148_document_quarantine_verdict.sql
check_in grid_qverdict "SELECT quarantine->'reasons'->0->>'term' || ',' || (quarantine->>'omitted') || ',' || (quarantine->'reasons'->1->>'sample') FROM documents WHERE id = 'd1d1d1d1-0000-4000-8000-000000000148'" "Lohnzettel,3,AT61 •••• •••• •••• 3201" "the backfill stores a quarantined row's verdict as data"
check_in grid_qverdict "SELECT string_agg(filename, ',' ORDER BY filename) FROM documents WHERE organization_id = 'org_0148' AND quarantine IS NULL" "brief.pdf,form.pdf,kaputt.pdf,plan.pdf" "a message that is not JSON, a verdict of the wrong shape, a row that is not held and one with no message stay NULL"
check_in grid_qverdict "SELECT count(*) FROM documents WHERE organization_id = 'org_0148' AND error_message LIKE 'quarantined:%'" "4" "the backfill leaves every message for the builds that still read it"
check_in grid_qverdict "SELECT reasons_omitted FROM document_quarantine_decisions WHERE id = 'f1f1f1f1-0000-4000-8000-000000000148'" "0" "an existing decision left nothing out that it knew of"
refused_in grid_qverdict "UPDATE documents SET quarantine = '[]'::jsonb WHERE id = 'd5d5d5d5-0000-4000-8000-000000000148';" "documents_quarantine_shape_check" "a verdict that is not an object was accepted"
refused_in grid_qverdict "UPDATE documents SET quarantine = '{\"checked\":\"full\"}'::jsonb WHERE id = 'd5d5d5d5-0000-4000-8000-000000000148';" "documents_quarantine_shape_check" "a verdict without reasons was accepted"
refused_in grid_qverdict "UPDATE documents SET quarantine = '{\"reasons\":[]}'::jsonb WHERE id = 'd4d4d4d4-0000-4000-8000-000000000148';" "documents_quarantine_held_check" "a verdict on a row that is not quarantined was accepted"
refused_in grid_qverdict "UPDATE documents SET status = 'uploaded', screening_outcome = 'released', screening_released_hash = 'sha256:lohn', screening_released_by = 'user_2', screening_released_at = now() WHERE id = 'd1d1d1d1-0000-4000-8000-000000000148';" "documents_quarantine_held_check" "a release that keeps the verdict was accepted"
sql_in grid_qverdict <<<"UPDATE documents SET status = 'uploaded', error_message = NULL, quarantine = NULL, screening_outcome = 'released', screening_released_hash = 'sha256:lohn', screening_released_by = 'user_2', screening_released_at = now() WHERE id = 'd1d1d1d1-0000-4000-8000-000000000148';"
check_in grid_qverdict "SELECT status FROM documents WHERE id = 'd1d1d1d1-0000-4000-8000-000000000148'" "uploaded" "the release that clears the verdict passes the hold"
refused_in grid_qverdict "INSERT INTO document_quarantine_decisions (organization_id, document_id, job_id, scope, filename, uploaded_by, reasons_omitted) VALUES ('org_0148', gen_random_uuid(), 'job-x', 'archiv', 'x.pdf', 'u', -1);" "document_quarantine_decisions_reasons_omitted_check" "a negative count of left-out reasons was accepted"
apply_in grid_qverdict 0148_document_quarantine_verdict.sql
check_in grid_qverdict "SELECT count(*) FROM documents WHERE organization_id = 'org_0148' AND quarantine IS NOT NULL" "0" "0148 re-applies and backfills no released row"
apply_in grid_qverdict 0148_document_quarantine_verdict.down.sql
check_in grid_qverdict "SELECT count(*) FROM information_schema.columns WHERE (table_name = 'documents' AND column_name = 'quarantine') OR (table_name = 'document_quarantine_decisions' AND column_name = 'reasons_omitted')" "0" "down dropped both columns"
apply_in grid_qverdict 0148_document_quarantine_verdict.sql
apply_in grid_qverdict 0148_document_quarantine_verdict.sql
check_in grid_qverdict "SELECT count(*) FROM pg_constraint WHERE conname IN ('documents_quarantine_shape_check', 'documents_quarantine_held_check', 'document_quarantine_decisions_reasons_omitted_check')" "3" "0148 re-applies, twice"
echo "==> 0148 quarantine verdict and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0150: whom an Anmerkung or a reply mentions, the CHECKs, and the
# DOWN.
#
# On a database of its own, migrated to 0149. Every mark and reply written
# before mentions nobody; a mention list is an array of at most ten, on both
# tables; the down drops both columns and leaves the marks and their threads.
# ---------------------------------------------------------------------------
echo "==> verifying the 0150 mentions on marks and replies and their down migration on grid_mention"
migrate_until grid_mention 0149_piloti_wakes_document_idx
sql_in grid_mention <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000150', 'org_0150', 'Erwähnen 0150', 'user_1', 'proj_0150');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000150', 'org_0150', 'user_1', 'a.pdf', 'k/0150/a', 'proj_0150', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000150');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000150', 'org_0150', 'd1d1d1d1-0000-4000-8000-000000000150', 1, 1, 'point', 0.5, 0.5, 'defect', 'Türbreite', 'person', 'open', 'user_1');
INSERT INTO document_annotation_replies (organization_id, annotation_id, author_kind, body, created_by)
VALUES ('org_0150', 'f1f1f1f1-0000-4000-8000-000000000150', 'person', 'Vor 0150 geschrieben', 'user_2');
SQL
apply_in grid_mention 0150_annotation_mentions.sql
check_in grid_mention "SELECT (SELECT string_agg(mentions::text, ',') FROM document_annotations) || '|' || (SELECT string_agg(mentions::text, ',') FROM document_annotation_replies)" "[]|[]" "a mark and a reply written before 0150 mention nobody"
sql_in grid_mention <<<"UPDATE document_annotations SET mentions = '[{\"targetId\":\"user_2\",\"display\":\"Anna Berger\"}]' WHERE number = 1"
sql_in grid_mention <<<"UPDATE document_annotation_replies SET mentions = '[{\"targetId\":\"agent:piloti\",\"display\":\"Piloti\"}]'"
check_in grid_mention "SELECT mentions->0->>'display' FROM document_annotations WHERE number = 1" "Anna Berger" "a mark keeps whom it mentions"
refused_in grid_mention "UPDATE document_annotations SET mentions = '{\"targetId\":\"user_2\"}' WHERE number = 1" "document_annotations_mentions_bounded" "a mark's mentions that are not an array were accepted"
refused_in grid_mention "UPDATE document_annotations SET mentions = (SELECT jsonb_agg(jsonb_build_object('targetId', 'user_' || n, 'display', 'P' || n)) FROM generate_series(1, 11) AS n) WHERE number = 1" "document_annotations_mentions_bounded" "a mark mentioning eleven people was accepted"
refused_in grid_mention "UPDATE document_annotation_replies SET mentions = '\"user_2\"'" "document_annotation_replies_mentions_bounded" "a reply's mentions that are not an array were accepted"
refused_in grid_mention "UPDATE document_annotation_replies SET mentions = (SELECT jsonb_agg(jsonb_build_object('targetId', 'user_' || n, 'display', 'P' || n)) FROM generate_series(1, 11) AS n)" "document_annotation_replies_mentions_bounded" "a reply mentioning eleven people was accepted"
refused_in grid_mention "UPDATE document_annotation_replies SET mentions = NULL" "null value" "a reply without a mention list was accepted"
apply_in grid_mention 0150_annotation_mentions.down.sql
check_in grid_mention "SELECT count(*) FROM information_schema.columns WHERE column_name = 'mentions' AND table_name IN ('document_annotations', 'document_annotation_replies')" "0" "down dropped both columns"
check_in grid_mention "SELECT (SELECT count(*) FROM document_annotations) || ':' || (SELECT count(*) FROM document_annotation_replies)" "1:1" "down left the marks and their threads"
apply_in grid_mention 0150_annotation_mentions.sql
apply_in grid_mention 0150_annotation_mentions.sql
check_in grid_mention "SELECT string_agg(mentions::text, ',') FROM document_annotation_replies" "[]" "0150 re-applies, twice"
echo "==> 0150 mentions and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0151: a mark carried on to the document that replaced its own, the
# index the daily due reminder reads by, and the DOWN.
#
# On a database of its own, migrated to 0150. A mark written before carries
# from nothing; a carried mark points back at its source, never at itself;
# one source is carried once, whatever raced; deleting the source leaves the
# carried mark standing without its link; the down drops the column and the
# indexes and leaves both marks.
# ---------------------------------------------------------------------------
echo "==> verifying the 0151 carried marks and their down migration on grid_carry"
migrate_until grid_carry 0150_annotation_mentions
sql_in grid_carry <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000151', 'org_0151', 'Weitertragen 0151', 'user_1', 'proj_0151');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000151', 'org_0151', 'user_1', 'Index B.pdf', 'k/0151/b', 'proj_0151', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000151'),
       ('d2d2d2d2-0000-4000-8000-000000000151', 'org_0151', 'user_1', 'Index C.pdf', 'k/0151/c', 'proj_0151', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000151');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by, assignee_user_id, due_on)
VALUES ('f1f1f1f1-0000-4000-8000-000000000151', 'org_0151', 'd1d1d1d1-0000-4000-8000-000000000151', 4, 1, 'point', 0.5, 0.5, 'defect', 'Brüstung', 'person', 'open', 'user_1', 'user_2', '2026-10-24');
SQL
apply_in grid_carry 0151_annotation_carry_and_due.sql
check_in grid_carry "SELECT coalesce(carried_from_id::text, 'null') FROM document_annotations" "null" "a mark written before 0151 carries from nothing"
sql_in grid_carry <<'SQL'
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by, carried_from_id)
VALUES ('f2f2f2f2-0000-4000-8000-000000000151', 'org_0151', 'd2d2d2d2-0000-4000-8000-000000000151', 1, 1, 'point', 0.5, 0.5, 'defect', 'Brüstung', 'person', 'open', 'user_1', 'f1f1f1f1-0000-4000-8000-000000000151');
SQL
C150="INSERT INTO document_annotations (organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by, carried_from_id) VALUES ('org_0151', 'd2d2d2d2-0000-4000-8000-000000000151'"
refused_in grid_carry "$C150, 2, 1, 'point', 0.5, 0.5, 'defect', 'x', 'person', 'open', 'user_1', 'f1f1f1f1-0000-4000-8000-000000000151')" "uniq_document_annotations_carried_from" "a mark was carried twice"
refused_in grid_carry "UPDATE document_annotations SET carried_from_id = id WHERE number = 1" "document_annotations_carried_from_other" "a mark was carried from itself"
refused_in grid_carry "$C150, 3, 1, 'point', 0.5, 0.5, 'defect', 'x', 'person', 'open', 'user_1', 'f9f9f9f9-0000-4000-8000-000000000151')" "document_annotations_carried_from_fkey" "a mark was carried from a mark that does not exist"
check_in grid_carry "SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_document_annotations_due'" "1" "0151 builds the due index"
sql_in grid_carry <<<"DELETE FROM document_annotations WHERE id = 'f1f1f1f1-0000-4000-8000-000000000151'"
check_in grid_carry "SELECT number || ':' || coalesce(carried_from_id::text, 'null') FROM document_annotations" "1:null" "deleting the source leaves the carried mark without its link"
apply_in grid_carry 0151_annotation_carry_and_due.down.sql
check_in grid_carry "SELECT count(*) FROM information_schema.columns WHERE column_name = 'carried_from_id' AND table_name = 'document_annotations'" "0" "down dropped the column"
check_in grid_carry "SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_document_annotations_due', 'uniq_document_annotations_carried_from')" "0" "down dropped both indexes"
check_in grid_carry "SELECT count(*) FROM document_annotations" "1" "down left the marks"
apply_in grid_carry 0151_annotation_carry_and_due.sql
apply_in grid_carry 0151_annotation_carry_and_due.sql
check_in grid_carry "SELECT coalesce(carried_from_id::text, 'null') FROM document_annotations" "null" "0151 re-applies, twice"
echo "==> 0151 carried marks and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0152: when a reply was last changed by its author, its CHECK, and
# the DOWN.
#
# On a database of its own, migrated to 0151. A reply written before was never
# edited; an edit stamped by the database's clock passes; an edit before the
# reply was written is refused; the down drops the column and leaves the
# reply with its words.
# ---------------------------------------------------------------------------
echo "==> verifying the 0152 reply edits and their down migration on grid_reply_edit"
migrate_until grid_reply_edit 0151_annotation_carry_and_due
sql_in grid_reply_edit <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000152', 'org_0152', 'Bearbeiten 0152', 'user_1', 'proj_0152');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000152', 'org_0152', 'user_1', 'a.pdf', 'k/0152/a', 'proj_0152', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000152');
INSERT INTO document_annotations (id, organization_id, document_id, number, page, shape, x, y, kind, body, author_kind, status, created_by)
VALUES ('f1f1f1f1-0000-4000-8000-000000000152', 'org_0152', 'd1d1d1d1-0000-4000-8000-000000000152', 1, 1, 'point', 0.5, 0.5, 'defect', 'Türbreite', 'person', 'open', 'user_1');
INSERT INTO document_annotation_replies (id, organization_id, annotation_id, author_kind, body, created_by)
VALUES ('e1e1e1e1-0000-4000-8000-000000000152', 'org_0152', 'f1f1f1f1-0000-4000-8000-000000000152', 'person', 'Vor 0152 geschrieben', 'user_2');
SQL
apply_in grid_reply_edit 0152_annotation_reply_edits.sql
check_in grid_reply_edit "SELECT coalesce(edited_at::text, 'null') FROM document_annotation_replies" "null" "a reply written before 0152 was never edited"
sql_in grid_reply_edit <<<"UPDATE document_annotation_replies SET body = 'Nachher', edited_at = now()"
check_in grid_reply_edit "SELECT body || ':' || (edited_at IS NOT NULL)::text FROM document_annotation_replies" "Nachher:true" "an edit stamped by the database's clock passes"
refused_in grid_reply_edit "UPDATE document_annotation_replies SET edited_at = created_at - interval '1 second'" "document_annotation_replies_edited_after_created" "an edit before the reply was written was accepted"
apply_in grid_reply_edit 0152_annotation_reply_edits.down.sql
check_in grid_reply_edit "SELECT count(*) FROM information_schema.columns WHERE column_name = 'edited_at' AND table_name = 'document_annotation_replies'" "0" "down dropped the column"
check_in grid_reply_edit "SELECT body FROM document_annotation_replies" "Nachher" "down left the reply with its words"
apply_in grid_reply_edit 0152_annotation_reply_edits.sql
apply_in grid_reply_edit 0152_annotation_reply_edits.sql
check_in grid_reply_edit "SELECT coalesce(edited_at::text, 'null') FROM document_annotation_replies" "null" "0152 re-applies, twice"
echo "==> 0152 reply edits and down migration verified"

# ---------------------------------------------------------------------------
# On a database of its own, migrated to 0156. An intake written before 0157
# has opened nothing; a reading's files are an array and nothing else; the
# down drops the column and leaves the intake; the up re-applies, twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0157 reading files and their down migration on grid_rfiles"
migrate_until grid_rfiles 0156_organization_default_locale_unset
sql_in grid_rfiles <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000156', 'org_0156', 'Erfassung 0156', 'user_1', 'proj_0156');
INSERT INTO project_intakes (organization_id, project_id, created_by, status, job_id, requested_by)
VALUES ('org_0156', 'aaaaaaaa-0000-4000-8000-000000000156', 'user_1', 'reading', 'job_0156', 'user_1');
SQL
apply_in grid_rfiles 0157_intake_reading_files.sql
check_in grid_rfiles "SELECT reading_files::text FROM project_intakes" "[]" "an intake written before 0156 has opened nothing"
sql_in grid_rfiles <<<"UPDATE project_intakes SET reading_files = '[\"Einreichplan.pdf\"]'::jsonb"
check_in grid_rfiles "SELECT reading_files->>0 FROM project_intakes" "Einreichplan.pdf" "a reading's opened files are stored"
refused_in grid_rfiles "UPDATE project_intakes SET reading_files = '{\"a\":1}'::jsonb" "project_intakes_reading_files_array" "reading files that are not an array were accepted"
apply_in grid_rfiles 0157_intake_reading_files.down.sql
check_in grid_rfiles "SELECT count(*) FROM information_schema.columns WHERE column_name = 'reading_files' AND table_name = 'project_intakes'" "0" "down dropped the column"
check_in grid_rfiles "SELECT status FROM project_intakes" "reading" "down left the intake"
apply_in grid_rfiles 0157_intake_reading_files.sql
apply_in grid_rfiles 0157_intake_reading_files.sql
check_in grid_rfiles "SELECT reading_files::text FROM project_intakes" "[]" "0156 re-applies, twice"
echo "==> 0157 reading files and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0163: the names stored in a message's metadata become English, and
# the DOWN.
#
# On a database of its own, migrated to whatever precedes 0163, seeded with one
# assistant message that holds every family the migration rewrites in its OLD
# spelling (findings, a callout, the run ledger, citations, the Herleitung's
# lanes and locator event, quote stamps, cards and a surface), one that is
# already English, and one with an old-looking word on a path the migration does
# not own. The up rewrites exactly the first, a second run changes nothing, the
# down restores the old spellings byte for byte on those paths, and the up
# re-applies twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0163 message metadata names and their down migration on grid_msgnames"
migrate_before grid_msgnames 0163_message_metadata_english
sql_in grid_msgnames <<'SQL'
INSERT INTO conversations (id, organization_id, created_by) VALUES ('s_0162', 'org_0162', 'user_1');
INSERT INTO messages (id, conversation_id, organization_id, role, content, metadata) VALUES
  ('a0000000-0000-4000-8000-000000000162', 's_0162', 'org_0162', 'assistant', 'Bericht', '{
    "findings": {"v": 1, "items": [
      {"requirement": "R", "status": "nicht_erfuellt", "grounding": "abgeleitet"},
      {"requirement": "S", "status": "offen", "grounding": "offen"},
      {"requirement": "T", "grounding": "belegt"}]},
    "answerMeta": {"v": 1, "callout": {"kind": "frist", "text": "Binnen sechs Wochen."}},
    "run_ledger": {"runId": "r1", "status": "laeuft",
      "phases": [{"phase": "planen", "startedAt": "2026-01-01T00:00:00.000Z", "endedAt": "2026-01-01T00:01:00.000Z"},
                 {"phase": "recherchieren", "startedAt": "2026-01-01T00:01:00.000Z"}],
      "steps": [{"id": "runde-1", "phase": "recherchieren", "intent": "x", "startedAt": "2026-01-01T00:01:00.000Z", "docs": []}],
      "error": {"reason": "x", "completedBefore": ["planen"]},
      "grundlage": [{"name": "a.pdf", "loci": []}],
      "startedAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:01:00.000Z"},
    "citations": {"v": 1, "sources": [
      {"content": "c", "kind": "baurecht", "lane": "baurecht_oib_leitfaden", "binding_status": "verbindlich_erklaert", "rank": "landesgesetz", "punkt": "3.5.2", "shelf": "archiv"},
      {"content": "d", "kind": "projekt", "lane": "projekt", "binding_status": "unbekannt"}]},
    "provenance": {"degradedReasons": ["grundlage_unread", "no_report_file"],
      "thinkingSteps": [
        {"id": "s1", "userMessageId": "u", "kind": "sources", "traceLanes": [{"key": "buero_piloti", "label": "x", "kind": "buero", "hitCount": 1, "sources": [], "signal": "office"}]},
        {"id": "s2", "userMessageId": "u", "kind": "retrieval", "turnEvent": {"key": "status.retrieval.punkt", "values": {"document": "D", "punkt": "3.1"}}},
        {"id": "s3", "userMessageId": "u", "kind": "retrieval", "turnEvent": {"key": "status.retrieval.plain", "values": {"punkt": "kept"}}}],
      "retrievalLedger": [{"index": 0, "key": "status.retrieval.punkt"}],
      "quoteStamps": [{"text": "q", "status": "verbatim", "punkt": "3.1"}]},
    "cards": [
      {"type": "fire_access_plan", "aufstellflaeche": {"width": 1}, "gebaeudeklasse": "GK 4"},
      {"type": "guardrail_check", "context": "dachterrasse"},
      {"type": "building_section", "markers": [{"label": "F", "height_m": 1, "kind": "fluchtniveau"}, {"label": "G", "height_m": 2, "kind": "threshold"}]},
      {"type": "document_draft", "path": "/entwuerfe/a.md"},
      {"type": "document_grid", "documents": [{"file_name": "a", "source": "buero"}]},
      {"type": "surface", "components": [{"id": "root", "component": "Column", "children": ["g"]}, {"id": "g", "component": "guardrail_check", "context": "balkon"}, {"id": "t", "component": "Text", "text": "x"}]},
      {"type": "calculation", "title": "bleibt", "status": "offen"}]
  }'),
  ('a0000000-0000-4000-8000-000000000163', 's_0162', 'org_0162', 'assistant', 'Neu', '{
    "findings": {"v": 1, "items": [{"requirement": "R", "status": "open", "grounding": "open"}]},
    "run_ledger": {"runId": "r2", "status": "done", "phases": [{"phase": "filed", "startedAt": "2026-01-01T00:00:00.000Z"}], "steps": [], "startedAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"},
    "citations": {"v": 1, "sources": [{"content": "c", "kind": "building_law", "lane": "building_law_oib", "clause": "3.5.2"}]}
  }'),
  ('a0000000-0000-4000-8000-000000000164', 's_0162', 'org_0162', 'assistant', 'Fremd', '{
    "note": {"status": "offen", "kind": "baurecht"},
    "cards": [{"type": "calculation", "title": "Rechenweg", "kind": "projekt", "status": "erfuellt"}]
  }'),
  ('a0000000-0000-4000-8000-000000000165', 's_0162', 'org_0162', 'user', 'Frage', NULL);
INSERT INTO citation_events (organization_id, conversation_id, turn_id, agent, kind, severity, detail) VALUES
  ('org_0162', 's_0162', 't1', 'shallow', 'turn_verified', 'info', '{"lanes": {"baurecht_oib": 2, "projekt": 1, "web": 3}, "origins": {"kb": 3}}');
SQL
OLD_0162=$(cat <<'SQL'
SELECT md5(string_agg(coalesce(metadata::text, '-'), '|' ORDER BY id)) FROM messages WHERE id <> 'a0000000-0000-4000-8000-000000000163'
SQL
)
BEFORE_0162=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_msgnames -tAc "$OLD_0162")
apply_in grid_msgnames 0163_message_metadata_english.sql
M_0162="SELECT metadata FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'"
check_in grid_msgnames "SELECT (metadata @> '{\"findings\": {\"items\": [{\"status\": \"not_met\", \"grounding\": \"derived\"}, {\"status\": \"open\", \"grounding\": \"open\"}, {\"grounding\": \"sourced\"}]}}')::text FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "true" "0163 rewrites a finding's status and grounding"
check_in grid_msgnames "SELECT metadata #>> '{answerMeta,callout,kind}' FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "deadline" "0163 rewrites a callout kind"
check_in grid_msgnames "SELECT (metadata #>> '{run_ledger,status}') || ',' || (metadata #>> '{run_ledger,phases,0,phase}') || ',' || (metadata #>> '{run_ledger,phases,1,phase}') || ',' || (metadata #>> '{run_ledger,steps,0,phase}') || ',' || (metadata #>> '{run_ledger,error,completedBefore,0}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "running,planning,researching,researching,planning" "0163 rewrites the run ledger's status and phases"
check_in grid_msgnames "SELECT ((metadata -> 'run_ledger') ? 'grundlage')::text || ',' || (metadata #>> '{run_ledger,basis,0,name}') || ',' || (metadata #>> '{run_ledger,steps,0,id}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "false,a.pdf,runde-1" "0163 renames the ledger's basis key and leaves the step id"
check_in grid_msgnames "SELECT (metadata #>> '{citations,sources,0,kind}') || ',' || (metadata #>> '{citations,sources,0,lane}') || ',' || (metadata #>> '{citations,sources,0,binding_status}') || ',' || (metadata #>> '{citations,sources,0,rank}') || ',' || (metadata #>> '{citations,sources,0,clause}') || ',' || ((metadata #> '{citations,sources,0}') ? 'punkt')::text || ',' || (metadata #>> '{citations,sources,0,shelf}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "building_law,building_law_oib_guide,declared_binding,state_law,3.5.2,false,archiv" "0163 rewrites a citation's kind, lane, binding status, rank and Punkt, and leaves its shelf"
check_in grid_msgnames "SELECT (metadata #>> '{citations,sources,1,kind}') || ',' || (metadata #>> '{citations,sources,1,lane}') || ',' || (metadata #>> '{citations,sources,1,binding_status}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "project,project,unknown" "0163 rewrites a project citation"
check_in grid_msgnames "SELECT (metadata #>> '{provenance,degradedReasons}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" '["basis_unread", "no_report_file"]' "0163 rewrites a degraded reason and keeps the others"
check_in grid_msgnames "SELECT (metadata #>> '{provenance,thinkingSteps,0,traceLanes,0,key}') || ',' || (metadata #>> '{provenance,thinkingSteps,0,traceLanes,0,kind}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "office_piloti,office" "0163 rewrites a trace lane's key and kind"
check_in grid_msgnames "SELECT (metadata #> '{provenance,thinkingSteps,1,turnEvent}')::text FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" '{"key": "status.retrieval.clause", "values": {"clause": "3.1", "document": "D"}}' "0163 renames the locator event's key and its value"
check_in grid_msgnames "SELECT (metadata #>> '{provenance,thinkingSteps,2,turnEvent,values,punkt}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "kept" "0163 leaves a value named punkt on another event"
check_in grid_msgnames "SELECT (metadata #>> '{provenance,retrievalLedger,0,key}') || ',' || (metadata #>> '{provenance,quoteStamps,0,clause}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "status.retrieval.clause,3.1" "0163 rewrites the ledger's key and a quote stamp's Punkt"
check_in grid_msgnames "SELECT (metadata #>> '{cards,0,staging_area,width}') || ',' || (metadata #>> '{cards,0,building_class}') || ',' || ((metadata #> '{cards,0}') ? 'aufstellflaeche')::text FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "1,GK 4,false" "0163 renames a fire access card's fields"
check_in grid_msgnames "SELECT (metadata #>> '{cards,1,context}') || ',' || (metadata #>> '{cards,2,markers,0,kind}') || ',' || (metadata #>> '{cards,2,markers,1,kind}') || ',' || (metadata #>> '{cards,3,path}') || ',' || (metadata #>> '{cards,4,documents,0,source}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "roof_terrace,escape_level,threshold,/drafts/a.md,office" "0163 rewrites a railing context, a section marker, a draft path and a document source"
check_in grid_msgnames "SELECT (metadata #>> '{cards,5,components,1,context}') || ',' || (metadata #>> '{cards,5,components,2,text}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" "balcony,x" "0163 rewrites a card inside a surface"
check_in grid_msgnames "SELECT (metadata #> '{cards,6}')::text FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000162'" '{"type": "calculation", "title": "bleibt", "status": "offen"}' "0163 leaves a card it has no rule for"
check_in grid_msgnames "SELECT (metadata #>> '{run_ledger,status}') || ',' || (metadata #>> '{findings,items,0,status}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000163'" "done,open" "0163 leaves English metadata alone"
check_in grid_msgnames "SELECT (metadata #> '{note}')::text || (metadata #>> '{cards,0,kind}') || (metadata #>> '{cards,0,status}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000164'" '{"kind": "baurecht", "status": "offen"}projekterfuellt' "0163 leaves an old-looking word on a path it does not own"
check_in grid_msgnames "SELECT count(*) FROM messages WHERE metadata IS NULL" "1" "0163 leaves a message without metadata alone"
check_in grid_msgnames "SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(detail -> 'lanes') k) FROM citation_events WHERE conversation_id = 's_0162'" "building_law_oib,project,web" "0163 renames the lane keys of a citation event and keeps their counts"
AFTER_ONCE_0162=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_msgnames -tAc "$OLD_0162")
apply_in grid_msgnames 0163_message_metadata_english.sql
check_in grid_msgnames "$OLD_0162" "$AFTER_ONCE_0162" "0163 changes nothing the second time"
apply_in grid_msgnames 0163_message_metadata_english.down.sql
check_in grid_msgnames "$OLD_0162" "$BEFORE_0162" "down restores every stored byte of the metadata the migration took"
check_in grid_msgnames "SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(detail -> 'lanes') k) FROM citation_events WHERE conversation_id = 's_0162'" "baurecht_oib,projekt,web" "down restores a citation event's lane keys"
check_in grid_msgnames "SELECT (metadata #>> '{run_ledger,status}') || ',' || (metadata #>> '{findings,items,0,status}') FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000163'" "fertig,offen" "down turns a message the new build wrote back into German too"
apply_in grid_msgnames 0163_message_metadata_english.sql
apply_in grid_msgnames 0163_message_metadata_english.sql
check_in grid_msgnames "$OLD_0162" "$AFTER_ONCE_0162" "0163 re-applies, twice"
echo "==> 0163 message metadata names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0164: the research plan's stored keys and values become English, and
# the DOWN.
#
# On a database of its own, migrated to whatever precedes 0164. A plan preview
# whose fence holds the old keys and values (and prose OUTSIDE the fence that
# mentions the same words), the reader's `approve {…}` reply as a user message
# and as the card's stored answer, a task, a standing task and a run that froze
# the reader's documents, and a Büroablage proposal whose payload names its
# shelf. The up rewrites the fence and the reply as text (nothing else in the
# message), the documents' keys, the payloads and the CHECK that reads them; a
# second run changes nothing; the down restores the bytes; the up re-applies
# twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0164 plan names and their down migration on grid_plannames"
migrate_before grid_plannames 0164_plan_documents_english
sql_in grid_plannames <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000163', 'org_0163', 'Plan 0164', 'user_1', 'proj_0163');
INSERT INTO conversations (id, organization_id, created_by, project_id) VALUES ('s_0163', 'org_0163', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000163');
INSERT INTO messages (id, conversation_id, organization_id, role, content, metadata) VALUES
  ('a0000000-0000-4000-8000-000000000263', 's_0163', 'org_0163', 'assistant',
   E'**Research Plan Preview**\n\nDie grundlage ist unklar: "grundlage": kein Schluessel hier.\n\n```plan_json\n{"title": "Pruefung \\"grundlage\\": x", "sections": ["A"], "genre": "pruefbericht", "depth": "kurzpruefung", "grundlage": ["Einreichplan.pdf"], "ausgeschlossen": [], "unterlagen": [{"name": "Einreichplan.pdf"}]}\n```\n\n---\nReply **approve**',
   NULL),
  ('a0000000-0000-4000-8000-000000000264', 's_0163', 'org_0163', 'user',
   'approve {"sections":["A"],"genre":"aktenvermerk","depth":"gutachten","grundlage":["a.pdf"],"ausgeschlossen":["b.pdf"],"data_sources":["knowledge_base"]}', NULL),
  ('a0000000-0000-4000-8000-000000000265', 's_0163', 'org_0163', 'assistant', 'Plan', '{"promptState": {"response": "approve {\"genre\":\"vergleich\",\"grundlage\":[]}", "respondedAt": "2026-01-01T00:00:00.000Z"}}'),
  ('a0000000-0000-4000-8000-000000000266', 's_0163', 'org_0163', 'assistant', E'Ein ```plan_json\n{"genre": "report", "basis": []}\n```', NULL),
  ('a0000000-0000-4000-8000-000000000267', 's_0163', 'org_0163', 'user', 'Bitte "grundlage": pruefen, genre pruefbericht', NULL);
INSERT INTO tasks (id, organization_id, project_id, kind, title, plan, requester_user_id) VALUES
  ('eeeeeeee-0000-4000-8000-000000000163', 'org_0163', 'aaaaaaaa-0000-4000-8000-000000000163', 'document', 'Dokument',
   '{"prompt": "x", "skill": {}, "dataSources": null, "documents": {"grundlage": [{"name": "a.pdf", "shelf": "project"}], "ausgeschlossen": [{"name": "b.pdf"}]}}', 'user_1'),
  ('eeeeeeee-0000-4000-8000-000000000164', 'org_0163', 'aaaaaaaa-0000-4000-8000-000000000163', 'document', 'Ohne',
   '{"prompt": "x", "skill": {}, "dataSources": null}', 'user_1');
INSERT INTO task_definitions (organization_id, project_id, kind, title, plan, requester_user_id, trigger) VALUES
  ('org_0163', 'aaaaaaaa-0000-4000-8000-000000000163', 'document', 'Dokument',
   '{"prompt": "x", "skill": {}, "dataSources": null, "documents": {"grundlage": [{"name": "a.pdf"}], "ausgeschlossen": []}}', 'user_1', 'manual');
INSERT INTO task_runs (organization_id, project_id, kind, title, plan, requester_user_id, trigger, status, skill_snapshot) VALUES
  ('org_0163', 'aaaaaaaa-0000-4000-8000-000000000163', 'document', 'Dokument',
   '{"prompt": "x", "skill": {}, "dataSources": null, "documents": {"grundlage": [], "ausgeschlossen": [{"name": "c.pdf"}]}}', 'user_1', 'delegated', 'succeeded', '{}');
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES
  ('c1c1c1c1-0000-4000-8000-000000000163', 'org_0163', NULL, 'archiv', 'file_operation',
   '{"operation": "move", "operations": [{"document": "a.pdf", "source": "buero", "target_folder": "x"}, {"document": "b.pdf", "source": "buero"}]}', 'piloti', 'user_1'),
  ('c1c1c1c1-0000-4000-8000-000000000164', 'org_0163', 'aaaaaaaa-0000-4000-8000-000000000163', 'project', 'file_operation',
   '{"operation": "move", "operations": [{"document": "c.pdf", "source": "projekt", "target_folder": "x"}]}', 'piloti', 'user_1');
SQL
PLAN_0163="SELECT md5(coalesce((SELECT string_agg(content, '|' ORDER BY id) FROM messages WHERE id <> 'a0000000-0000-4000-8000-000000000266'), '') || (SELECT string_agg(coalesce(metadata::text, '-'), '|' ORDER BY id) FROM messages) || (SELECT string_agg(plan::text, '|' ORDER BY title, id) FROM tasks) || (SELECT string_agg(plan::text, '|') FROM task_definitions) || (SELECT string_agg(plan::text, '|') FROM task_runs) || (SELECT string_agg(payload::text, '|' ORDER BY id) FROM proposed_changes))"
BEFORE_0163=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_plannames -tAc "$PLAN_0163")
apply_in grid_plannames 0164_plan_documents_english.sql
check_in grid_plannames "SELECT content FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000263'" $'**Research Plan Preview**\n\nDie grundlage ist unklar: "grundlage": kein Schluessel hier.\n\n```plan_json\n{"title": "Pruefung \\"grundlage\\": x", "sections": ["A"], "genre": "inspection_report", "depth": "quick_check", "basis": ["Einreichplan.pdf"], "excluded": [], "documents": [{"name": "Einreichplan.pdf"}]}\n```\n\n---\nReply **approve**' "0164 rewrites the keys and values inside the fence and nothing outside it, nor an escaped quote inside a title"
check_in grid_plannames "SELECT content FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000264'" 'approve {"sections":["A"],"genre":"file_note","depth":"expert_report","basis":["a.pdf"],"excluded":["b.pdf"],"data_sources":["knowledge_base"]}' "0164 rewrites an approval reply"
check_in grid_plannames "SELECT metadata #>> '{promptState,response}' FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000265'" 'approve {"genre":"comparison","basis":[]}' "0164 rewrites the answered card's reply"
check_in grid_plannames "SELECT content FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000266'" $'Ein ```plan_json\n{"genre": "report", "basis": []}\n```' "0164 leaves a plan that is already English"
check_in grid_plannames "SELECT content FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000267'" 'Bitte "grundlage": pruefen, genre pruefbericht' "0164 leaves a message that has neither a fence nor an approval"
check_in grid_plannames "SELECT (plan -> 'documents')::text FROM tasks WHERE id = 'eeeeeeee-0000-4000-8000-000000000163'" '{"basis": [{"name": "a.pdf", "shelf": "project"}], "excluded": [{"name": "b.pdf"}]}' "0164 renames the keys of a task's documents"
check_in grid_plannames "SELECT (plan ? 'documents')::text FROM tasks WHERE id = 'eeeeeeee-0000-4000-8000-000000000164'" "false" "0164 does not invent documents on a task that named none"
check_in grid_plannames "SELECT ((SELECT plan -> 'documents' FROM task_definitions)::text) || ((SELECT plan -> 'documents' FROM task_runs)::text)" '{"basis": [{"name": "a.pdf"}], "excluded": []}{"basis": [], "excluded": [{"name": "c.pdf"}]}' "0164 renames the keys on a standing task and on a run"
check_in grid_plannames "SELECT (payload #>> '{operations,0,source}') || ',' || (payload #>> '{operations,1,source}') FROM proposed_changes WHERE id = 'c1c1c1c1-0000-4000-8000-000000000163'" "office,office" "0164 rewrites a Büroablage proposal's sources"
check_in grid_plannames "SELECT payload #>> '{operations,0,source}' FROM proposed_changes WHERE id = 'c1c1c1c1-0000-4000-8000-000000000164'" "project" "0164 rewrites a project proposal's source"
refused_in grid_plannames "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0163', NULL, 'archiv', 'file_operation', '{\"operation\": \"move\", \"operations\": [{\"document\": \"x.pdf\", \"source\": \"buero\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "the CHECK still accepts the old source"
check_in grid_plannames "SELECT convalidated::text FROM pg_constraint WHERE conname = 'proposed_changes_archiv_move' AND conrelid = 'proposed_changes'::regclass" "true" "the CHECK is validated"
sql_in grid_plannames <<'SQL'
INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES
  ('org_0163', NULL, 'archiv', 'file_operation', '{"operation": "move", "operations": [{"document": "x.pdf", "source": "office"}]}', 'piloti', 'user_1');
SQL
sql_in grid_plannames <<'SQL'
DELETE FROM proposed_changes WHERE payload #>> '{operations,0,document}' = 'x.pdf';
SQL
AFTER_ONCE_0163=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_plannames -tAc "$PLAN_0163")
apply_in grid_plannames 0164_plan_documents_english.sql
check_in grid_plannames "$PLAN_0163" "$AFTER_ONCE_0163" "0164 changes nothing the second time"
apply_in grid_plannames 0164_plan_documents_english.down.sql
check_in grid_plannames "$PLAN_0163" "$BEFORE_0163" "down restores every stored byte of what the migration took"
refused_in grid_plannames "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0163', NULL, 'archiv', 'file_operation', '{\"operation\": \"move\", \"operations\": [{\"document\": \"x.pdf\", \"source\": \"office\"}]}', 'piloti', 'user_1')" "proposed_changes_archiv_move" "down put the CHECK back on the old source"
apply_in grid_plannames 0164_plan_documents_english.sql
apply_in grid_plannames 0164_plan_documents_english.sql
check_in grid_plannames "$PLAN_0163" "$AFTER_ONCE_0163" "0164 re-applies, twice"
echo "==> 0164 plan names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0165: the Fassung table, a constraint and an inbox type take English
# names, and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0165. The announcement
# table is renamed with its key and its policy (still one, still tenant-scoped);
# the Büroablage CHECK keeps refusing what it refused under its new name; an
# inbox row of the old type moves to the new one together with its group key,
# and a row of another type is left alone. The down puts every name back, and
# the up re-applies twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0165 revision names and their down migration on grid_revnames"
migrate_before grid_revnames 0165_revision_names
sql_in grid_revnames <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000164', 'org_0165', 'Namen 0165', 'user_1', 'proj_0165');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
VALUES ('d1d1d1d1-0000-4000-8000-000000000164', 'org_0165', 'user_1', 'neu.pdf', 'k/0165/neu', 'proj_0165', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000164');
INSERT INTO document_fassung_announcements (organization_id, document_id, anchor_id) VALUES
  ('org_0165', 'd1d1d1d1-0000-4000-8000-000000000164', 'd2d2d2d2-0000-4000-8000-000000000164'),
  ('org_other', 'd1d1d1d1-0000-4000-8000-000000000164', 'd3d3d3d3-0000-4000-8000-000000000164');
INSERT INTO inbox_items (organization_id, recipient_user_id, type, resource_type, resource_id, anchor_id, group_key, actionable) VALUES
  ('org_0165', 'user_1', 'document.new_fassung', 'document', 'd1d1d1d1-0000-4000-8000-000000000164', 'd2d2d2d2-0000-4000-8000-000000000164',
   'document.new_fassung:document:d1d1d1d1-0000-4000-8000-000000000164:d2d2d2d2-0000-4000-8000-000000000164', false),
  ('org_0165', 'user_1', 'job.completed', 'document', 'd1d1d1d1-0000-4000-8000-000000000164', NULL,
   'job.completed:document:d1d1d1d1-0000-4000-8000-000000000164', false);
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of)
VALUES ('c1c1c1c1-0000-4000-8000-000000000164', 'org_0165', NULL, 'archiv', 'file_operation',
        '{"operation":"move","operations":[{"document":"Norm.pdf","source":"office","target_folder":"Normen"}]}', 'piloti', 'user_1');
SQL
apply_in grid_revnames 0165_revision_names.sql
check_in grid_revnames "SELECT (to_regclass('document_revision_announcements') IS NOT NULL AND to_regclass('document_fassung_announcements') IS NULL)::text" "true" "0165 renames the announcement table"
check_in grid_revnames "SELECT count(*) FROM document_revision_announcements" "2" "0165 keeps the announcements"
check_in grid_revnames "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'document_revision_announcements'::regclass AND contype <> 'n'" "document_revision_announcements_document_fkey,document_revision_announcements_pk" "0165 renames the key and the foreign key"
check_in grid_revnames "SELECT relrowsecurity::text || ':' || (SELECT count(*) FROM pg_policy WHERE polrelid = 'document_revision_announcements'::regclass)::text FROM pg_class WHERE relname = 'document_revision_announcements'" "true:1" "the renamed table is secured by exactly one policy"
RW164=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_revnames -qtA \
  -c "SET grid.organization_id = 'org_0165'" \
  -c "SELECT count(*) FROM document_revision_announcements")
if [ "$RW164" != "1" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_revnames: the runtime role saw another organization's announcements, or not its own (got: $RW164)" >&2
  exit 1
fi
check_in grid_revnames "SELECT string_agg(type, ',' ORDER BY type) FROM inbox_items" "document.new_revision,job.completed" "0165 gives the inbox row the new type and leaves the others"
check_in grid_revnames "SELECT group_key FROM inbox_items WHERE type = 'document.new_revision'" "document.new_revision:document:d1d1d1d1-0000-4000-8000-000000000164:d2d2d2d2-0000-4000-8000-000000000164" "0165 moves the group key with the type"
check_in grid_revnames "SELECT (count(*) FILTER (WHERE conname = 'proposed_changes_office_shelf_move') - count(*) FILTER (WHERE conname = 'proposed_changes_archiv_move'))::text FROM pg_constraint WHERE conrelid = 'proposed_changes'::regclass" "1" "0165 renames the Büroablage constraint"
refused_in grid_revnames "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0165', NULL, 'archiv', 'memory', '{}', 'piloti', 'user_1')" "proposed_changes_office_shelf_move" "the renamed constraint still refuses a Büroablage proposal that is not a move"
apply_in grid_revnames 0165_revision_names.down.sql
check_in grid_revnames "SELECT (to_regclass('document_fassung_announcements') IS NOT NULL AND to_regclass('document_revision_announcements') IS NULL)::text" "true" "down gives the announcement table its name back"
check_in grid_revnames "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'document_fassung_announcements'::regclass AND contype <> 'n'" "document_fassung_announcements_document_fkey,document_fassung_announcements_pk" "down restores the key names"
check_in grid_revnames "SELECT string_agg(type, ',' ORDER BY type) FROM inbox_items" "document.new_fassung,job.completed" "down restores the inbox type"
check_in grid_revnames "SELECT group_key FROM inbox_items WHERE type = 'document.new_fassung'" "document.new_fassung:document:d1d1d1d1-0000-4000-8000-000000000164:d2d2d2d2-0000-4000-8000-000000000164" "down restores the group key"
check_in grid_revnames "SELECT count(*) FROM pg_constraint WHERE conname = 'proposed_changes_archiv_move' AND conrelid = 'proposed_changes'::regclass" "1" "down restores the Büroablage constraint name"
apply_in grid_revnames 0165_revision_names.sql
apply_in grid_revnames 0165_revision_names.sql
check_in grid_revnames "SELECT count(*) FROM document_revision_announcements" "2" "0165 re-applies, twice"
echo "==> 0165 revision names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0166: English kinds on permit records and their requirements, and
# the DOWN.
#
# On a database of its own, migrated to whatever precedes 0166. Every German kind
# is rewritten and the new CHECK refuses the old spelling; `nachforderung` is
# the one word both tables share and becomes `information_request` in both.
# ---------------------------------------------------------------------------
echo "==> verifying the 0166 permit kinds and their down migration on grid_permit_kinds"
migrate_before grid_permit_kinds 0166_permit_kinds
sql_in grid_permit_kinds <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000165', 'org_0166', 'Bescheide 0166', 'user_1', 'proj_0166');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000165', 'org_0166', 'user_1', 'a.pdf', 'k/0166/a', 'proj_0166', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000165'),
  ('d2d2d2d2-0000-4000-8000-000000000165', 'org_0166', 'user_1', 'b.pdf', 'k/0166/b', 'proj_0166', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000165'),
  ('d3d3d3d3-0000-4000-8000-000000000165', 'org_0166', 'user_1', 'c.pdf', 'k/0166/c', 'proj_0166', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000165'),
  ('d4d4d4d4-0000-4000-8000-000000000165', 'org_0166', 'user_1', 'd.pdf', 'k/0166/d', 'proj_0166', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000165');
INSERT INTO permit_records (id, organization_id, project_id, document_id, collection_name, file_name, kind, model) VALUES
  ('e1e1e1e1-0000-4000-8000-000000000165', 'org_0166', 'aaaaaaaa-0000-4000-8000-000000000165', 'd1d1d1d1-0000-4000-8000-000000000165', 'proj_0166', 'a.pdf', 'bewilligung', 'm'),
  ('e2e2e2e2-0000-4000-8000-000000000165', 'org_0166', 'aaaaaaaa-0000-4000-8000-000000000165', 'd2d2d2d2-0000-4000-8000-000000000165', 'proj_0166', 'b.pdf', 'nachforderung', 'm'),
  ('e3e3e3e3-0000-4000-8000-000000000165', 'org_0166', 'aaaaaaaa-0000-4000-8000-000000000165', 'd3d3d3d3-0000-4000-8000-000000000165', 'proj_0166', 'c.pdf', 'ablehnung', 'm'),
  ('e4e4e4e4-0000-4000-8000-000000000165', 'org_0166', 'aaaaaaaa-0000-4000-8000-000000000165', 'd4d4d4d4-0000-4000-8000-000000000165', 'proj_0166', 'd.pdf', 'sonstiges', 'm');
INSERT INTO permit_requirements (organization_id, record_id, project_id, position, kind, content) VALUES
  ('org_0166', 'e1e1e1e1-0000-4000-8000-000000000165', 'aaaaaaaa-0000-4000-8000-000000000165', 1, 'auflage', 'Brandschutzkonzept vorlegen.'),
  ('org_0166', 'e2e2e2e2-0000-4000-8000-000000000165', 'aaaaaaaa-0000-4000-8000-000000000165', 1, 'nachforderung', 'Statischen Nachweis ergänzen.'),
  ('org_0166', 'e2e2e2e2-0000-4000-8000-000000000165', 'aaaaaaaa-0000-4000-8000-000000000165', 2, 'hinweis', 'Frist beachten.');
SQL
apply_in grid_permit_kinds 0166_permit_kinds.sql
check_in grid_permit_kinds "SELECT string_agg(kind, ',' ORDER BY file_name) FROM permit_records" "approval,information_request,refusal,other" "0166 rewrites every record kind"
check_in grid_permit_kinds "SELECT string_agg(kind, ',' ORDER BY position, kind) FROM permit_requirements" "condition,information_request,note" "0166 rewrites every requirement kind"
refused_in grid_permit_kinds "UPDATE permit_records SET kind = 'bewilligung' WHERE file_name = 'a.pdf'" "permit_records_kind_check" "the old record kind was accepted"
refused_in grid_permit_kinds "UPDATE permit_requirements SET kind = 'auflage' WHERE position = 1 AND kind = 'condition'" "permit_requirements_kind_check" "the old requirement kind was accepted"
check_in grid_permit_kinds "SELECT count(*) FROM pg_constraint WHERE conname IN ('permit_records_kind_check', 'permit_requirements_kind_check') AND convalidated" "2" "both CHECKs are validated"
apply_in grid_permit_kinds 0166_permit_kinds.down.sql
check_in grid_permit_kinds "SELECT string_agg(kind, ',' ORDER BY file_name) FROM permit_records" "bewilligung,nachforderung,ablehnung,sonstiges" "down restores the record kinds"
check_in grid_permit_kinds "SELECT string_agg(kind, ',' ORDER BY position, kind) FROM permit_requirements" "auflage,nachforderung,hinweis" "down restores the requirement kinds"
refused_in grid_permit_kinds "UPDATE permit_records SET kind = 'approval' WHERE file_name = 'a.pdf'" "permit_records_kind_check" "down left the English record kind accepted"
apply_in grid_permit_kinds 0166_permit_kinds.sql
apply_in grid_permit_kinds 0166_permit_kinds.sql
check_in grid_permit_kinds "SELECT string_agg(kind, ',' ORDER BY file_name) FROM permit_records" "approval,information_request,refusal,other" "0166 re-applies, twice"
echo "==> 0166 permit kinds and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0167: the task kind, the document roles and the BIM rule ids take
# English values, and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0167. A role or a rule
# id that exists under both spellings for the same key (an older pod wrote the
# old one after the migration ran) keeps the new one. Nothing else moves.
# ---------------------------------------------------------------------------
echo "==> verifying the 0167 task, role and rule names and their down migration on grid_task_names"
migrate_before grid_task_names 0167_task_role_and_rule_names
sql_in grid_task_names <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000166', 'org_0167', 'Namen 0167', 'user_1', 'proj_0167');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000166', 'org_0167', 'user_1', 'plan.pdf', 'k/0167/plan', 'proj_0167', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000166'),
  ('d2d2d2d2-0000-4000-8000-000000000166', 'org_0167', 'user_1', 'modell.ifc', 'k/0167/modell', 'proj_0167', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000166');
INSERT INTO tasks (organization_id, project_id, kind, title, plan, requester_user_id) VALUES
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'einreichcheck', 'Einreichcheck', '{"prompt":"x","skill":{},"dataSources":null}', 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'document', 'Dokument', '{"prompt":"x","skill":{},"dataSources":null}', 'user_1');
INSERT INTO task_definitions (organization_id, project_id, kind, title, plan, requester_user_id, trigger) VALUES
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'einreichcheck', 'Einreichcheck', '{"prompt":"x","skill":{},"dataSources":null}', 'user_1', 'manual');
INSERT INTO task_runs (organization_id, project_id, kind, title, plan, requester_user_id, trigger, status, skill_snapshot) VALUES
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'einreichcheck', 'Einreichcheck', '{"prompt":"x","skill":{},"dataSources":null}', 'user_1', 'delegated', 'succeeded', '{}'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'compliance_check', 'Normprüfung', '{"prompt":"x","skill":{},"dataSources":null}', 'user_1', 'delegated', 'succeeded', '{}');
INSERT INTO document_roles (organization_id, project_id, document_id, role, scope_instance_id, created_by) VALUES
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'd1d1d1d1-0000-4000-8000-000000000166', 'bebauungsplan', NULL, 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'd1d1d1d1-0000-4000-8000-000000000166', 'bestandsplan', 'b1', 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'd1d1d1d1-0000-4000-8000-000000000166', 'lageplan', NULL, 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'd1d1d1d1-0000-4000-8000-000000000166', 'site_plan', NULL, 'user_2');
INSERT INTO bim_models (id, organization_id, project_id, document_id, status)
VALUES ('f1f1f1f1-0000-4000-8000-000000000166', 'org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'd2d2d2d2-0000-4000-8000-000000000166', 'completed');
INSERT INTO bim_check_confirmations (organization_id, project_id, rule_id, model_id, confirmed_by) VALUES
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'oib2-feuerwiderstand-tragend', 'f1f1f1f1-0000-4000-8000-000000000166', 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'oib3-raumhoehe', 'f1f1f1f1-0000-4000-8000-000000000166', 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'oib4-tuer-durchgangsbreite', 'f1f1f1f1-0000-4000-8000-000000000166', 'user_1'),
  ('org_0167', 'aaaaaaaa-0000-4000-8000-000000000166', 'oib4-door-clear-width', 'f1f1f1f1-0000-4000-8000-000000000166', 'user_2');
SQL
apply_in grid_task_names 0167_task_role_and_rule_names.sql
check_in grid_task_names "SELECT string_agg(kind, ',' ORDER BY kind) FROM tasks" "document,submission_check" "0167 renames the kind on tasks"
check_in grid_task_names "SELECT string_agg(kind, ',') FROM task_definitions" "submission_check" "0167 renames the kind on task_definitions"
check_in grid_task_names "SELECT string_agg(kind, ',' ORDER BY kind) FROM task_runs" "compliance_check,submission_check" "0167 renames the kind on task_runs and leaves the others"
check_in grid_task_names "SELECT string_agg(role || ':' || coalesce(scope_instance_id, '-') || ':' || created_by, ',' ORDER BY role) FROM document_roles" "development_plan:-:user_1,existing_plans:b1:user_1,site_plan:-:user_2" "0167 renames the roles, and the binding that existed under both spellings keeps the new one"
check_in grid_task_names "SELECT string_agg(rule_id || ':' || confirmed_by, ',' ORDER BY rule_id) FROM bim_check_confirmations" "oib2-fire-resistance-load-bearing:user_1,oib3-room-height:user_1,oib4-door-clear-width:user_2" "0167 renames the rule ids, and the confirmation that existed under both spellings keeps the new one"
apply_in grid_task_names 0167_task_role_and_rule_names.down.sql
check_in grid_task_names "SELECT string_agg(kind, ',' ORDER BY kind) FROM tasks" "document,einreichcheck" "down restores the task kind"
check_in grid_task_names "SELECT string_agg(role, ',' ORDER BY role) FROM document_roles" "bebauungsplan,bestandsplan,lageplan" "down restores the roles"
check_in grid_task_names "SELECT string_agg(rule_id, ',' ORDER BY rule_id) FROM bim_check_confirmations" "oib2-feuerwiderstand-tragend,oib3-raumhoehe,oib4-tuer-durchgangsbreite" "down restores the rule ids"
apply_in grid_task_names 0167_task_role_and_rule_names.sql
apply_in grid_task_names 0167_task_role_and_rule_names.sql
check_in grid_task_names "SELECT string_agg(role, ',' ORDER BY role) FROM document_roles" "development_plan,existing_plans,site_plan" "0167 re-applies, twice"
echo "==> 0167 task, role and rule names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0168: English topic tags on conversations, and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0168. Each array is
# rewritten element by element in the order of first appearance, an old key
# and its new spelling in one array collapse to one, a conversation without an
# old key is not touched (its `updated_at` stays), and the rewrite does not
# bump `updated_at` of one that is.
# ---------------------------------------------------------------------------
echo "==> verifying the 0168 conversation tag names and their down migration on grid_tag_names"
migrate_before grid_tag_names 0168_conversation_tag_names
sql_in grid_tag_names <<'SQL'
INSERT INTO conversations (id, organization_id, created_by, tags, updated_at) VALUES
  ('s_0168_a', 'org_0168', 'user_1', ARRAY['brandschutz', 'statik', 'brandschutz'], '2026-01-01 10:00:00+00'),
  ('s_0168_b', 'org_0168', 'user_1', ARRAY['allgemein'], '2026-01-02 10:00:00+00'),
  ('s_0168_c', 'org_0168', 'user_1', ARRAY['hygiene'], '2026-01-03 10:00:00+00'),
  ('s_0168_d', 'org_0168', 'user_1', ARRAY['fire_safety', 'brandschutz', 'energie'], '2026-01-04 10:00:00+00'),
  ('s_0168_e', 'org_0168', 'user_1', '{}', '2026-01-05 10:00:00+00');
SQL
apply_in grid_tag_names 0168_conversation_tag_names.sql
check_in grid_tag_names "SELECT string_agg(id || '=' || array_to_string(tags, '|'), ',' ORDER BY id) FROM conversations" "s_0168_a=fire_safety|structural,s_0168_b=general,s_0168_c=hygiene,s_0168_d=fire_safety|energy,s_0168_e=" "0168 rewrites the tags in order, without duplicates"
check_in grid_tag_names "SELECT count(*) FROM conversations WHERE updated_at <> ('2026-01-0' || (ascii(right(id, 1)) - 96)::text || ' 10:00:00+00')::timestamptz" "0" "0168 does not bump updated_at"
apply_in grid_tag_names 0168_conversation_tag_names.down.sql
check_in grid_tag_names "SELECT string_agg(id || '=' || array_to_string(tags, '|'), ',' ORDER BY id) FROM conversations" "s_0168_a=brandschutz|statik,s_0168_b=allgemein,s_0168_c=hygiene,s_0168_d=brandschutz|energie,s_0168_e=" "down restores the German keys"
apply_in grid_tag_names 0168_conversation_tag_names.sql
apply_in grid_tag_names 0168_conversation_tag_names.sql
check_in grid_tag_names "SELECT array_to_string(tags, '|') FROM conversations WHERE id = 's_0168_a'" "fire_safety|structural" "0168 re-applies, twice"
echo "==> 0168 conversation tag names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0169: English names for the builtin skills, and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0169. An
# organization's decision about a playbook follows the rename, a clone that kept
# the builtin's name keeps shadowing it, a job and a standing task keep naming
# the skill, and a slash token inside a path is not one.
# ---------------------------------------------------------------------------
echo "==> verifying the 0169 skill names and their down migration on grid_skill_names"
migrate_before grid_skill_names 0169_skill_names
sql_in grid_skill_names <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000168', 'org_0169', 'Skills 0169', 'user_1', 'proj_0169');
INSERT INTO platform_skills (name, description, body, created_by) VALUES
  ('einreichcheck', 'd', 'b', 'platform'),
  ('brandschutz', 'd', 'b', 'platform'),
  ('fire-safety', 'd', 'b', 'platform');
INSERT INTO curated_skill_activations (organization_id, skill_name, enabled, updated_by) VALUES
  ('org_0169', 'einreichcheck', false, 'user_1'),
  ('org_0169', 'bestand', true, 'user_1'),
  ('org_0169', 'brandschutz', true, 'user_1'),
  ('org_0169', 'fire-safety', false, 'user_2');
INSERT INTO skills (organization_id, name, description, body, origin, cloned_from, created_by) VALUES
  ('org_0169', 'einreichcheck', 'd', 'b', 'platform-clone', 'einreichcheck', 'user_1'),
  ('org_0169', 'bestand', 'd', 'b', 'platform-clone', 'bestand', 'user_1'),
  ('org_0169', 'existing-building', 'd', 'b', 'org', NULL, 'user_1'),
  ('org_0169', 'brandschutz-check', 'd', 'b', 'platform-clone', 'brandschutz', 'user_1'),
  ('org_0169', 'hausregeln', 'd', 'b', 'org', NULL, 'user_1');
INSERT INTO jobs (id, project_id, organization_id, name, prompt, skill_name, skill_snapshot, output, enabled, schedule_timezone, created_by)
VALUES
  ('bbbbbbbb-0000-4000-8000-000000000168', 'aaaaaaaa-0000-4000-8000-000000000168', 'org_0169', 'Wöchentlich', '/einreichcheck bis Freitag; Ablage /brandschutz/eg bleibt', 'einreichcheck',
   '{"name":"einreichcheck","description":"d","body":"b","metadata":{},"origin":"platform"}', 'chat', true, 'UTC', 'user_1'),
  ('bbbbbbbb-0000-4000-8000-000000000169', 'aaaaaaaa-0000-4000-8000-000000000168', 'org_0169', 'Ohne Skill', 'Prüfe den Bestand', NULL, NULL, 'chat', true, 'UTC', 'user_1');
INSERT INTO task_definitions (organization_id, project_id, kind, title, plan, requester_user_id, trigger) VALUES
  ('org_0169', 'aaaaaaaa-0000-4000-8000-000000000168', 'compliance_check', 'Einreichcheck', '{"prompt":"Prüfe — /einreichcheck.","skill":{"name":"einreichcheck"},"dataSources":null}', 'user_1', 'manual');
SQL
apply_in grid_skill_names 0169_skill_names.sql
check_in grid_skill_names "SELECT string_agg(name, ',' ORDER BY name) FROM platform_skills" "fire-safety,submission-check" "0169 renames the platform skills, and the one that existed under both names keeps the new one"
check_in grid_skill_names "SELECT string_agg(skill_name || ':' || enabled::text || ':' || updated_by, ',' ORDER BY skill_name) FROM curated_skill_activations" "existing-building:true:user_1,fire-safety:false:user_2,submission-check:false:user_1" "0169 carries an organization's decision over to the new name"
check_in grid_skill_names "SELECT string_agg(name || '<' || coalesce(cloned_from, '-'), ',' ORDER BY name) FROM skills" "bestand<existing-building,brandschutz-check<fire-safety,existing-building<-,hausregeln<-,submission-check<submission-check" "0169 renames a clone that kept the builtin's name (unless the organization already has the new one, as with bestand) and repoints cloned_from"
check_in grid_skill_names "SELECT coalesce(skill_name, '-') || '|' || coalesce(skill_snapshot ->> 'name', '-') || '|' || prompt FROM jobs WHERE name = 'Wöchentlich'" "submission-check|submission-check|/submission-check bis Freitag; Ablage /brandschutz/eg bleibt" "0169 renames a job's skill and its slash token, and not a path"
check_in grid_skill_names "SELECT prompt FROM jobs WHERE name = 'Ohne Skill'" "Prüfe den Bestand" "0169 leaves the words of a prompt alone"
check_in grid_skill_names "SELECT (plan ->> 'prompt') || '|' || (plan #>> '{skill,name}') FROM task_definitions" "Prüfe — /submission-check.|submission-check" "0169 renames the skill of a standing task"
apply_in grid_skill_names 0169_skill_names.down.sql
check_in grid_skill_names "SELECT string_agg(name, ',' ORDER BY name) FROM platform_skills" "brandschutz,einreichcheck" "down restores the platform skill names (the new-only duplicate is the loss)"
check_in grid_skill_names "SELECT string_agg(skill_name, ',' ORDER BY skill_name) FROM curated_skill_activations" "bestand,brandschutz,einreichcheck" "down restores the activations"
check_in grid_skill_names "SELECT skill_name || '|' || prompt FROM jobs WHERE name = 'Wöchentlich'" "einreichcheck|/einreichcheck bis Freitag; Ablage /brandschutz/eg bleibt" "down restores a job's skill and slash token"
apply_in grid_skill_names 0169_skill_names.sql
apply_in grid_skill_names 0169_skill_names.sql
check_in grid_skill_names "SELECT skill_name FROM jobs WHERE name = 'Wöchentlich'" "submission-check" "0169 re-applies, twice"
echo "==> 0169 skill names and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0172: the inbox payload's `marksFassung` becomes `marksRevision`, and
# the DOWN.
#
# On a database of its own, migrated to whatever precedes 0172. Only the key moves,
# the count stays; a payload with both keys keeps the new one's value; a row
# without the old key is not touched (its `updated_at` stays).
# ---------------------------------------------------------------------------
echo "==> verifying the 0172 inbox revision marks and their down migration on grid_revmarks"
migrate_before grid_revmarks 0172_inbox_revision_marks
sql_in grid_revmarks <<'SQL'
INSERT INTO inbox_items (id, organization_id, recipient_user_id, type, resource_type, resource_id, group_key, actionable, payload, updated_at) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000173', 'org_0173', 'user_1', 'document.new_revision', 'document', 'd1', 'g1', false, '{"openMarks": 3, "marksFassung": 2}', '2026-01-01 10:00:00+00'),
  ('a2a2a2a2-0000-4000-8000-000000000173', 'org_0173', 'user_1', 'document.new_revision', 'document', 'd2', 'g2', false, '{"openMarks": 1, "marksFassung": 1, "marksRevision": 4}', '2026-01-02 10:00:00+00'),
  ('a3a3a3a3-0000-4000-8000-000000000173', 'org_0173', 'user_1', 'document.new_revision', 'document', 'd3', 'g3', false, '{"openMarks": 2}', '2026-01-03 10:00:00+00');
SQL
apply_in grid_revmarks 0172_inbox_revision_marks.sql
check_in grid_revmarks "SELECT string_agg(payload::text, ' ' ORDER BY group_key) FROM inbox_items" '{"openMarks": 3, "marksRevision": 2} {"openMarks": 1, "marksRevision": 4} {"openMarks": 2}' "0172 renames the key, keeps the new key's value when both exist, and leaves other payloads alone"
check_in grid_revmarks "SELECT count(*) FROM inbox_items WHERE updated_at <> ('2026-01-0' || right(group_key, 1) || ' 10:00:00+00')::timestamptz" "0" "0172 does not bump updated_at"
apply_in grid_revmarks 0172_inbox_revision_marks.down.sql
check_in grid_revmarks "SELECT string_agg(payload::text, ' ' ORDER BY group_key) FROM inbox_items" '{"openMarks": 3, "marksFassung": 2} {"openMarks": 1, "marksFassung": 4} {"openMarks": 2}' "down restores the old key, with the value up kept (the newer one)"
apply_in grid_revmarks 0172_inbox_revision_marks.sql
apply_in grid_revmarks 0172_inbox_revision_marks.sql
check_in grid_revmarks "SELECT payload->>'marksRevision' FROM inbox_items WHERE group_key = 'g1'" "2" "0172 re-applies, twice"
echo "==> 0172 inbox revision marks and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0176: an organization-scoped operation proposal, one open call per
# conversation, and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0176, with three open
# operation proposals for one call in one conversation (the repeat 0176 folds), a
# different call, and a Büroablage move. The scope accepts `organization` with
# no project and only for an `operation`; the Büroablage CHECK still holds for
# the Büroablage; the unique index refuses a second open call, and frees it
# once decided. The runtime role sees its organization's proposals and no other's.
# ---------------------------------------------------------------------------
echo "==> verifying the 0176 organization operation proposals and their down migration on grid_orgop"
migrate_before grid_orgop 0176_organization_operation_proposals
sql_in grid_orgop <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000174', 'org_0176', 'Haus 0176', 'user_1', 'proj_0176');
INSERT INTO conversations (id, organization_id, created_by, project_id)
VALUES ('conv_0176', 'org_0176', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000174');
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of, origin_conversation_id, created_at) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000174', 'org_0176', 'aaaaaaaa-0000-4000-8000-000000000174', 'project', 'operation',
   '{"operation":"folder-rename","input":{"params":{"id":"p"},"body":{"name":"A"}},"summary":"s"}', 'piloti', 'user_1', 'conv_0176', '2026-01-01 10:00:00+00'),
  ('d2d2d2d2-0000-4000-8000-000000000174', 'org_0176', 'aaaaaaaa-0000-4000-8000-000000000174', 'project', 'operation',
   '{"operation":"folder-rename","input":{"body":{"name":"A"},"params":{"id":"p"}},"summary":"s"}', 'piloti', 'user_1', 'conv_0176', '2026-01-01 10:01:00+00'),
  ('d3d3d3d3-0000-4000-8000-000000000174', 'org_0176', 'aaaaaaaa-0000-4000-8000-000000000174', 'project', 'operation',
   '{"operation":"folder-rename","input":{"params":{"id":"p"},"body":{"name":"A"}},"summary":"s"}', 'piloti', 'user_1', 'conv_0176', '2026-01-01 10:02:00+00'),
  ('d4d4d4d4-0000-4000-8000-000000000174', 'org_0176', 'aaaaaaaa-0000-4000-8000-000000000174', 'project', 'operation',
   '{"operation":"folder-rename","input":{"params":{"id":"p"},"body":{"name":"B"}},"summary":"s"}', 'piloti', 'user_1', 'conv_0176', '2026-01-01 10:03:00+00');
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES
  ('d5d5d5d5-0000-4000-8000-000000000174', 'org_0176', NULL, 'office_shelf', 'file_operation',
   '{"operation":"move","operations":[{"document":"Norm.pdf","source":"office","target_folder":"Normen"}]}', 'piloti', 'user_1');
SQL
refused_in grid_orgop "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0176', NULL, 'organization', 'operation', '{}', 'piloti', 'user_1')" "violates check constraint" "the organization scope existed before 0176"
apply_in grid_orgop 0176_organization_operation_proposals.sql
check_in grid_orgop "SELECT string_agg(left(id::text, 2), ',' ORDER BY created_at) FROM proposed_changes WHERE kind = 'operation'" "d1,d4" "0176 folds a repeated open call to its oldest proposal, however its keys were ordered, and keeps another input"
check_in grid_orgop "SELECT count(*) FROM proposed_changes WHERE scope = 'office_shelf'" "1" "0176 leaves the Büroablage's proposal"
PO174="INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of, origin_conversation_id) VALUES ('org_0176'"
sql_in grid_orgop <<<"$PO174, NULL, 'organization', 'operation', '{\"operation\":\"organization-memory-create\",\"input\":{\"body\":{\"content\":\"x\"}},\"summary\":\"s\"}', 'piloti', 'user_1', 'conv_0176')"
check_in grid_orgop "SELECT count(*) FROM proposed_changes WHERE scope = 'organization'" "1" "an operation is stored on the organization with no project"
refused_in grid_orgop "$PO174, NULL, 'organization', 'memory', '{}', 'piloti', 'user_1', NULL)" "proposed_changes_organization_operation" "an organization-scoped note was accepted"
refused_in grid_orgop "$PO174, NULL, 'organization', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"a.pdf\",\"source\":\"office\"}]}', 'piloti', 'user_1', NULL)" "proposed_changes_organization_operation" "an organization-scoped file move was accepted"
refused_in grid_orgop "$PO174, 'aaaaaaaa-0000-4000-8000-000000000174', 'organization', 'operation', '{}', 'piloti', 'user_1', NULL)" "proposed_changes_scope_owner" "an organization-scoped proposal naming a project was accepted"
refused_in grid_orgop "$PO174, NULL, 'regal', 'operation', '{}', 'piloti', 'user_1', NULL)" "proposed_changes_scope_known" "an unknown shelf was accepted"
refused_in grid_orgop "$PO174, NULL, 'office_shelf', 'operation', '{}', 'piloti', 'user_1', NULL)" "proposed_changes_office_shelf_move" "a Büroablage proposal of another kind was accepted"
refused_in grid_orgop "$PO174, NULL, 'organization', 'operation', '{\"operation\":\"organization-memory-create\",\"input\":{\"body\":{\"content\":\"x\"}},\"summary\":\"again\"}', 'piloti', 'user_1', 'conv_0176')" "uniq_proposed_changes_open_operation" "a second open proposal of the same call was accepted"
sql_in grid_orgop <<<"$PO174, NULL, 'organization', 'operation', '{\"operation\":\"organization-memory-create\",\"input\":{\"body\":{\"content\":\"x\"}},\"summary\":\"no chat\"}', 'piloti', 'user_1', NULL), ('org_0176', NULL, 'organization', 'operation', '{\"operation\":\"organization-memory-create\",\"input\":{\"body\":{\"content\":\"x\"}},\"summary\":\"no chat\"}', 'piloti', 'user_1', NULL)"
sql_in grid_orgop <<'SQL'
UPDATE proposed_changes SET status = 'dismissed', decided_by = 'user_1', decided_at = now()
  WHERE scope = 'organization' AND origin_conversation_id = 'conv_0176';
INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of, origin_conversation_id)
VALUES ('org_0176', NULL, 'organization', 'operation',
        '{"operation":"organization-memory-create","input":{"body":{"content":"x"}},"summary":"again"}', 'piloti', 'user_1', 'conv_0176');
SQL
check_in grid_orgop "SELECT count(*) FROM proposed_changes WHERE scope = 'organization' AND origin_conversation_id = 'conv_0176'" "2" "a decided proposal frees its call, and a repeat in no conversation is not folded"
RW174=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_orgop -qtA \
  -c "SET grid.organization_id = 'org_other_0176'" \
  -c "SELECT count(*) FROM proposed_changes WHERE scope = 'organization'")
if [ "$RW174" != "0" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_orgop: the runtime role saw another organization's organization-scoped proposals (got: $RW174)" >&2
  exit 1
fi
apply_in grid_orgop 0176_organization_operation_proposals.down.sql
check_in grid_orgop "SELECT count(*) FROM proposed_changes WHERE scope = 'organization'" "0" "down deleted the organization-scoped proposals"
check_in grid_orgop "SELECT count(*) FROM pg_indexes WHERE indexname = 'uniq_proposed_changes_open_operation'" "0" "down dropped the open call's unique index"
refused_in grid_orgop "$PO174, NULL, 'organization', 'operation', '{}', 'piloti', 'user_1', NULL)" "violates check constraint" "down left the organization scope allowed"
refused_in grid_orgop "$PO174, NULL, 'office_shelf', 'operation', '{}', 'piloti', 'user_1', NULL)" "proposed_changes_office_shelf_move" "down left the Büroablage CHECK open to another kind"
apply_in grid_orgop 0176_organization_operation_proposals.sql
apply_in grid_orgop 0176_organization_operation_proposals.sql
check_in grid_orgop "SELECT count(*) FROM proposed_changes WHERE kind = 'operation'" "2" "0176 re-applies, twice, keeping the proposals it should"
echo "==> 0176 organization operation proposals and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0177: the inbox types of a task run say `task_run`, not `job`, and
# the DOWN.
#
# On a database of its own, migrated to whatever precedes 0177. Each of the three
# types moves with the front of its group key; another type is not touched.
# ---------------------------------------------------------------------------
echo "==> verifying the 0177 task run inbox types and their down migration on grid_taskruninbox"
migrate_before grid_taskruninbox 0177_task_run_inbox_types
sql_in grid_taskruninbox <<'SQL'
INSERT INTO inbox_items (id, organization_id, recipient_user_id, type, resource_type, resource_id, group_key, actionable) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000175', 'org_0177', 'user_1', 'job.completed', 'project', 'p1', 'job.completed:project:p1:j1', false),
  ('a2a2a2a2-0000-4000-8000-000000000175', 'org_0177', 'user_1', 'job.failed', 'project', 'p1', 'job.failed:project:p1:j2', false),
  ('a3a3a3a3-0000-4000-8000-000000000175', 'org_0177', 'user_1', 'job.waiting', 'project', 'p1', 'job.waiting:project:p1:r3', true),
  ('a4a4a4a4-0000-4000-8000-000000000175', 'org_0177', 'user_1', 'document.new_revision', 'document', 'd1', 'document.new_revision:document:d1:d2', false);
SQL
apply_in grid_taskruninbox 0177_task_run_inbox_types.sql
check_in grid_taskruninbox "SELECT string_agg(type || '=' || group_key, ' ' ORDER BY id) FROM inbox_items" "task_run.completed=task_run.completed:project:p1:j1 task_run.failed=task_run.failed:project:p1:j2 task_run.waiting=task_run.waiting:project:p1:r3 document.new_revision=document.new_revision:document:d1:d2" "0177 renames the three task run types with their group keys and leaves the others"
apply_in grid_taskruninbox 0177_task_run_inbox_types.down.sql
check_in grid_taskruninbox "SELECT string_agg(type || '=' || group_key, ' ' ORDER BY id) FROM inbox_items" "job.completed=job.completed:project:p1:j1 job.failed=job.failed:project:p1:j2 job.waiting=job.waiting:project:p1:r3 document.new_revision=document.new_revision:document:d1:d2" "down restores the job types and their group keys"
apply_in grid_taskruninbox 0177_task_run_inbox_types.sql
apply_in grid_taskruninbox 0177_task_run_inbox_types.sql
check_in grid_taskruninbox "SELECT count(*) FROM inbox_items WHERE type LIKE 'task_run.%'" "3" "0177 re-applies, twice"
echo "==> 0177 task run inbox types and down migration verified"
# Migration 0179: the asks another agent puts to Piloti (ADR-0124), and the DOWN.
#
# On a database of its own, migrated through 0179, with one conversation per
# organization. The CHECKs refuse an unknown state, a refusal without its
# reason, a reason on a running ask, a terminal ask without its end and a
# running one with an end; the composite key refuses an ask on another
# organization's conversation and cascades with the conversation. The runtime
# role sees its organization's asks and no other's. The down drops the table
# and leaves the conversations.
# ---------------------------------------------------------------------------
echo "==> verifying the 0179 asks and their down migration on grid_asks"
migrate_until grid_asks 0179_piloti_asks
sql_in grid_asks <<'SQL'
INSERT INTO conversations (id, organization_id, created_by) VALUES
  ('conv_0178_a', 'org_0178_a', 'user_1'),
  ('conv_0178_b', 'org_0178_b', 'user_2');
INSERT INTO piloti_asks (id, organization_id, conversation_id, requested_by) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000177', 'org_0178_a', 'conv_0178_a', 'user_1'),
  ('b1b1b1b1-0000-4000-8000-000000000177', 'org_0178_b', 'conv_0178_b', 'user_2');
UPDATE piloti_asks SET state = 'completed', ended_at = now() WHERE id = 'a1a1a1a1-0000-4000-8000-000000000177';
SQL
check_in grid_asks "SELECT state FROM piloti_asks WHERE id = 'b1b1b1b1-0000-4000-8000-000000000177'" "submitted" "0179: an ask starts submitted"
PA177="INSERT INTO piloti_asks (id, organization_id, conversation_id, requested_by, state, reason, ended_at) VALUES (gen_random_uuid(), 'org_0178_a', 'conv_0178_a', 'user_1'"
refused_in grid_asks "$PA177, 'input-required', NULL, now())" "piloti_asks_state_known" "an unknown state"
refused_in grid_asks "$PA177, 'rejected', NULL, now())" "piloti_asks_reason_when_refused" "a rejected ask without its reason"
refused_in grid_asks "$PA177, 'working', 'why', NULL)" "piloti_asks_reason_when_refused" "a reason on a running ask"
refused_in grid_asks "$PA177, 'failed', '', now())" "piloti_asks_reason_length" "an empty reason"
refused_in grid_asks "$PA177, 'completed', NULL, NULL)" "piloti_asks_ended_when_terminal" "a completed ask without its end"
refused_in grid_asks "$PA177, 'working', NULL, now())" "piloti_asks_ended_when_terminal" "a running ask with an end"
refused_in grid_asks "INSERT INTO piloti_asks (id, organization_id, conversation_id, requested_by) VALUES (gen_random_uuid(), 'org_0178_a', 'conv_0178_b', 'user_1')" "piloti_asks_conversation_fkey" "an ask on another organization's conversation"
RW177=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_asks -qtA \
  -c "SET grid.organization_id = 'org_0178_a'" \
  -c "SELECT string_agg(id::text, ',') FROM piloti_asks")
if [ "$RW177" != "a1a1a1a1-0000-4000-8000-000000000177" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_asks: the runtime role saw asks that are not its organization's (got: $RW177)" >&2
  exit 1
fi
sql_in grid_asks <<<"DELETE FROM conversations WHERE id = 'conv_0178_b';"
check_in grid_asks "SELECT count(*) FROM piloti_asks WHERE organization_id = 'org_0178_b'" "0" "0179: an ask goes with its conversation"
apply_in grid_asks 0179_piloti_asks.sql
check_in grid_asks "SELECT count(*) FROM piloti_asks" "1" "0179 re-applies and keeps the asks"
apply_in grid_asks 0179_piloti_asks.down.sql
check_in grid_asks "SELECT count(*) FROM pg_tables WHERE tablename = 'piloti_asks'" "0" "0179 down drops the table"
check_in grid_asks "SELECT count(*) FROM conversations WHERE id = 'conv_0178_a'" "1" "0179 down leaves the conversations"
apply_in grid_asks 0179_piloti_asks.sql
check_in grid_asks "SELECT count(*) FROM pg_tables WHERE tablename = 'piloti_asks'" "1" "0179 applies again after its down"
echo "==> 0179 asks and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0180: the folder cards of the file tools (ADR-0127), and the DOWN.
#
# On a database of its own, migrated through 0180, with one Archiv (office
# shelf) folder per organization. The CHECKs refuse an abstract past 600
# characters, key facts that are not an array or hold nine entries, and an
# unknown status; the composite key refuses a card on another organization's
# folder (or on the wrong shelf), a second card for one folder, and cascades
# with the folder. The runtime role sees its organization's cards and no
# other's, and cannot write one into another organization. The down drops the
# table and leaves the folders.
# ---------------------------------------------------------------------------
echo "==> verifying the 0180 folder cards and their down migration on grid_foldercards"
migrate_until grid_foldercards 0180_folder_cards
sql_in grid_foldercards <<'SQL'
INSERT INTO project_folders (id, organization_id, scope, name, path) VALUES
  ('f1f1f1f1-0000-4000-8000-000000000180', 'org_0180_a', 'office_shelf', 'Vertraege', 'Vertraege'),
  ('f2f2f2f2-0000-4000-8000-000000000180', 'org_0180_b', 'office_shelf', 'Vertraege', 'Vertraege'),
  ('f3f3f3f3-0000-4000-8000-000000000180', 'org_0180_b', 'office_shelf', 'Plaene', 'Plaene');
INSERT INTO folder_cards (organization_id, folder_id, scope, collection, input_hash) VALUES
  ('org_0180_a', 'f1f1f1f1-0000-4000-8000-000000000180', 'office_shelf', 'archiv_org_0180_a', 'h1'),
  ('org_0180_b', 'f2f2f2f2-0000-4000-8000-000000000180', 'office_shelf', 'archiv_org_0180_b', 'h2');
SQL
check_in grid_foldercards "SELECT status || ':' || key_facts::text FROM folder_cards WHERE organization_id = 'org_0180_a'" "stale:[]" "0180: a card starts stale with no key facts"
FC180="INSERT INTO folder_cards (organization_id, folder_id, scope, collection, input_hash"
refused_in grid_foldercards "UPDATE folder_cards SET abstract = repeat('a', 601) WHERE organization_id = 'org_0180_a'" "folder_cards_abstract_length" "an abstract past 600 characters"
refused_in grid_foldercards "UPDATE folder_cards SET key_facts = '{}'::jsonb WHERE organization_id = 'org_0180_a'" "folder_cards_key_facts_shape" "key facts that are not an array"
refused_in grid_foldercards "UPDATE folder_cards SET key_facts = '[1,2,3,4,5,6,7,8,9]'::jsonb WHERE organization_id = 'org_0180_a'" "folder_cards_key_facts_shape" "nine key facts"
refused_in grid_foldercards "UPDATE folder_cards SET status = 'building' WHERE organization_id = 'org_0180_a'" "folder_cards_status_check" "an unknown status"
refused_in grid_foldercards "$FC180) VALUES ('org_0180_a', 'f3f3f3f3-0000-4000-8000-000000000180', 'office_shelf', 'archiv_org_0180_a', 'h')" "folder_cards_folder_fkey" "a card on another organization's folder"
refused_in grid_foldercards "$FC180) VALUES ('org_0180_b', 'f3f3f3f3-0000-4000-8000-000000000180', 'project', 'archiv_org_0180_b', 'h')" "folder_cards_folder_fkey" "a card on the wrong shelf"
refused_in grid_foldercards "$FC180) VALUES ('org_0180_a', 'f1f1f1f1-0000-4000-8000-000000000180', 'office_shelf', 'archiv_org_0180_a', 'h')" "folder_cards_folder_key" "a second card for one folder"
RW180=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_foldercards -qtA \
  -c "SET grid.organization_id = 'org_0180_a'" \
  -c "SELECT string_agg(organization_id, ',') FROM folder_cards")
if [ "$RW180" != "org_0180_a" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_foldercards: the runtime role saw cards that are not its organization's (got: $RW180)" >&2
  exit 1
fi
RWUP180=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_foldercards -qtA \
  -c "SET grid.organization_id = 'org_0180_a'" \
  -c "WITH u AS (UPDATE folder_cards SET collection = 'x' WHERE organization_id = 'org_0180_b' RETURNING 1) SELECT count(*) FROM u")
if [ "$RWUP180" != "0" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_foldercards: the runtime role updated another organization's card (got: $RWUP180)" >&2
  exit 1
fi
sql_in grid_foldercards <<<"DELETE FROM project_folders WHERE id = 'f2f2f2f2-0000-4000-8000-000000000180';"
check_in grid_foldercards "SELECT count(*) FROM folder_cards WHERE organization_id = 'org_0180_b'" "0" "0180: a card goes with its folder"
apply_in grid_foldercards 0180_folder_cards.sql
check_in grid_foldercards "SELECT count(*) FROM folder_cards" "1" "0180 re-applies and keeps the cards"
apply_in grid_foldercards 0180_folder_cards.down.sql
check_in grid_foldercards "SELECT count(*) FROM pg_tables WHERE tablename = 'folder_cards'" "0" "0180 down drops the table"
check_in grid_foldercards "SELECT count(*) FROM project_folders WHERE id = 'f1f1f1f1-0000-4000-8000-000000000180'" "1" "0180 down leaves the folders"
apply_in grid_foldercards 0180_folder_cards.sql
check_in grid_foldercards "SELECT count(*) FROM pg_tables WHERE tablename = 'folder_cards'" "1" "0180 applies again after its down"
echo "==> 0180 folder cards and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0181: the office's conventions as Piloti counted them (ADR-0129),
# and the DOWN.
#
# On a database of its own, migrated through 0181, with one row per
# organization: the runtime role reads and updates only its own, a row is
# computed whole or not at all, and the down drops only the derived table.
# ---------------------------------------------------------------------------
echo "==> verifying the 0181 office conventions and their down migration on grid_officeconv"
migrate_until grid_officeconv 0181_office_conventions
sql_in grid_officeconv <<'SQL'
INSERT INTO office_conventions (organization_id, conventions, extractor_version, source_fingerprint, computed_at) VALUES
  ('org_0181_a', '{"version":1,"projects":3}'::jsonb, 1, 'fp_a', now()),
  ('org_0181_b', '{"version":1,"projects":4}'::jsonb, 1, 'fp_b', now());
INSERT INTO office_conventions (organization_id, refresh_requested_at) VALUES ('org_0181_c', now());
SQL
check_in grid_officeconv "SELECT count(*) FROM office_conventions WHERE conventions IS NULL" "1" "0181: a row may wait for its first refresh"
refused_in grid_officeconv "UPDATE office_conventions SET source_fingerprint = NULL WHERE organization_id = 'org_0181_a'" "office_conventions_computed_together" "conventions without their fingerprint"
refused_in grid_officeconv "UPDATE office_conventions SET conventions = '{}'::jsonb WHERE organization_id = 'org_0181_c'" "office_conventions_computed_together" "conventions without when they were computed"
RW181=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_officeconv -qtA \
  -c "SET grid.organization_id = 'org_0181_a'" \
  -c "SELECT string_agg(organization_id, ',') FROM office_conventions")
if [ "$RW181" != "org_0181_a" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_officeconv: the runtime role saw conventions that are not its organization's (got: $RW181)" >&2
  exit 1
fi
RWUP181=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_officeconv -qtA \
  -c "SET grid.organization_id = 'org_0181_a'" \
  -c "WITH u AS (UPDATE office_conventions SET refresh_requested_at = now() WHERE organization_id = 'org_0181_b' RETURNING 1) SELECT count(*) FROM u")
if [ "$RWUP181" != "0" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_officeconv: the runtime role updated another organization's conventions (got: $RWUP181)" >&2
  exit 1
fi
apply_in grid_officeconv 0181_office_conventions.sql
check_in grid_officeconv "SELECT count(*) FROM office_conventions" "3" "0181 re-applies and keeps the rows"
apply_in grid_officeconv 0181_office_conventions.down.sql
check_in grid_officeconv "SELECT count(*) FROM pg_tables WHERE tablename = 'office_conventions'" "0" "0181 down drops the table"
apply_in grid_officeconv 0181_office_conventions.sql
check_in grid_officeconv "SELECT count(*) FROM pg_tables WHERE tablename = 'office_conventions'" "1" "0181 applies again after its down"
echo "==> 0181 office conventions and down migration verified"

# ---------------------------------------------------------------------------
# 0182: a person's decision on one line of the office's conventions (ADR-0129).
# One row per organization and line, under RLS; the decision is confirmed or
# declined and the line is a JSON object. The down drops the table (authored
# rows go with it, which the down says).
# ---------------------------------------------------------------------------
echo "==> verifying the 0182 office convention decisions and their down migration on grid_officedec"
migrate_until grid_officedec 0182_office_convention_decisions
sql_in grid_officedec <<'SQL'
INSERT INTO office_convention_decisions (organization_id, line_key, decision, line, decided_by) VALUES
  ('org_0182_a', 'folder:behoerde', 'confirmed', '{"kind":"folder","key":"folder:behoerde"}'::jsonb, 'user_a'),
  ('org_0182_b', 'folder:behoerde', 'declined', '{"kind":"folder","key":"folder:behoerde"}'::jsonb, 'user_b');
SQL
check_in grid_officedec "SELECT count(*) FROM office_convention_decisions" "2" "0182: the same line may be decided by two organizations"
refused_in grid_officedec "INSERT INTO office_convention_decisions (organization_id, line_key, decision, line, decided_by) VALUES ('org_0182_a', 'folder:behoerde', 'declined', '{}'::jsonb, 'u')" "office_convention_decisions_pkey" "a second decision on one line"
refused_in grid_officedec "INSERT INTO office_convention_decisions (organization_id, line_key, decision, line, decided_by) VALUES ('org_0182_a', 'x', 'maybe', '{}'::jsonb, 'u')" "office_convention_decisions_decision_known" "a decision that is neither confirmed nor declined"
refused_in grid_officedec "INSERT INTO office_convention_decisions (organization_id, line_key, decision, line, decided_by) VALUES ('org_0182_a', 'y', 'confirmed', '[]'::jsonb, 'u')" "office_convention_decisions_line_object" "a line that is not an object"
RW182=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_officedec -qtA \
  -c "SET grid.organization_id = 'org_0182_a'" \
  -c "SELECT string_agg(organization_id, ',') FROM office_convention_decisions")
if [ "$RW182" != "org_0182_a" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_officedec: the runtime role saw decisions that are not its organization's (got: $RW182)" >&2
  exit 1
fi
RWUP182=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d grid_officedec -qtA \
  -c "SET grid.organization_id = 'org_0182_a'" \
  -c "WITH u AS (UPDATE office_convention_decisions SET decision = 'declined' WHERE organization_id = 'org_0182_b' RETURNING 1) SELECT count(*) FROM u")
if [ "$RWUP182" != "0" ]; then
  echo "MIGRATION ASSERTION FAILED on grid_officedec: the runtime role changed another organization's decision (got: $RWUP182)" >&2
  exit 1
fi
apply_in grid_officedec 0182_office_convention_decisions.sql
check_in grid_officedec "SELECT count(*) FROM office_convention_decisions" "2" "0182 re-applies and keeps the rows"
apply_in grid_officedec 0182_office_convention_decisions.down.sql
check_in grid_officedec "SELECT count(*) FROM pg_tables WHERE tablename = 'office_convention_decisions'" "0" "0182 down drops the table"
apply_in grid_officedec 0182_office_convention_decisions.sql
check_in grid_officedec "SELECT count(*) FROM pg_tables WHERE tablename = 'office_convention_decisions'" "1" "0182 applies again after its down"
echo "==> 0182 office convention decisions and down migration verified"

# ---------------------------------------------------------------------------
# 0183: a report's thread (ADR-0118, amended). The conversations session the
# server opened the ticket in is UUID-shaped or NULL; the down drops both
# columns and 0183 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0183 product feedback thread columns and their down migration on grid_feedbackthread"
migrate_until grid_feedbackthread 0183_product_feedback_thread
sql_in grid_feedbackthread <<'SQL'
INSERT INTO product_feedback (organization_id, user_id, kind, message, posthog_widget_session_id) VALUES
  ('org_0183_a', 'user_a', 'bug', 'The upload stops at 99 percent', '0b1c2d3e-4f50-4617-8899-aabbccddeeff'),
  ('org_0183_a', 'user_a', 'idea', 'Filed before 0183, no session', NULL);
SQL
check_in grid_feedbackthread "SELECT count(*) FROM product_feedback" "2" "0183: a session or none"
refused_in grid_feedbackthread "INSERT INTO product_feedback (organization_id, user_id, kind, message, posthog_widget_session_id) VALUES ('org_0183_a', 'u', 'bug', 'not a session id here', 'x;--')" "product_feedback_posthog_widget_session_id_shape" "a session id that is not UUID-shaped"
apply_in grid_feedbackthread 0183_product_feedback_thread.sql
check_in grid_feedbackthread "SELECT count(*) FROM product_feedback WHERE posthog_widget_session_id IS NOT NULL" "1" "0183 re-applies and keeps the session"
apply_in grid_feedbackthread 0183_product_feedback_thread.down.sql
check_in grid_feedbackthread "SELECT count(*) FROM information_schema.columns WHERE table_name = 'product_feedback' AND column_name IN ('posthog_widget_session_id', 'reporter_seen_at')" "0" "0183 down drops both columns"
apply_in grid_feedbackthread 0183_product_feedback_thread.sql
check_in grid_feedbackthread "SELECT count(*) FROM information_schema.columns WHERE table_name = 'product_feedback' AND column_name IN ('posthog_widget_session_id', 'reporter_seen_at')" "2" "0183 applies again after its down"
echo "==> 0183 product feedback thread and down migration verified"

# ---------------------------------------------------------------------------
# 0184: the reporter's notice of a team reply (ADR-0118, second amendment). The
# watermark is nullable and moves only forward under its compare-and-set; the
# down drops it and 0184 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0184 product feedback reply notice column and its down migration on grid_feedbacknotice"
migrate_until grid_feedbacknotice 0184_product_feedback_reply_notice
sql_in grid_feedbacknotice <<'SQL'
INSERT INTO product_feedback (organization_id, user_id, kind, message, posthog_ticket_id) VALUES
  ('org_0184_a', 'user_a', 'bug', 'The upload stops at 99 percent', 'ticket-0184');
SQL
check_in grid_feedbacknotice "SELECT count(*) FROM product_feedback WHERE reporter_notified_at IS NULL" "1" "0184: nothing announced yet"
check_in grid_feedbacknotice "WITH u AS (UPDATE product_feedback SET reporter_notified_at = '2026-10-22T10:00:00Z' WHERE posthog_ticket_id = 'ticket-0184' AND (reporter_notified_at IS NULL OR reporter_notified_at < '2026-10-22T10:00:00Z') RETURNING 1) SELECT count(*) FROM u" "1" "0184: the first poke moves the watermark"
check_in grid_feedbacknotice "WITH u AS (UPDATE product_feedback SET reporter_notified_at = '2026-10-22T10:00:00Z' WHERE posthog_ticket_id = 'ticket-0184' AND (reporter_notified_at IS NULL OR reporter_notified_at < '2026-10-22T10:00:00Z') RETURNING 1) SELECT count(*) FROM u" "0" "0184: a replayed poke moves nothing"
apply_in grid_feedbacknotice 0184_product_feedback_reply_notice.sql
check_in grid_feedbacknotice "SELECT count(*) FROM product_feedback WHERE reporter_notified_at IS NOT NULL" "1" "0184 re-applies and keeps the watermark"
apply_in grid_feedbacknotice 0184_product_feedback_reply_notice.down.sql
check_in grid_feedbacknotice "SELECT count(*) FROM information_schema.columns WHERE table_name = 'product_feedback' AND column_name = 'reporter_notified_at'" "0" "0184 down drops the column"
apply_in grid_feedbacknotice 0184_product_feedback_reply_notice.sql
check_in grid_feedbacknotice "SELECT count(*) FROM information_schema.columns WHERE table_name = 'product_feedback' AND column_name = 'reporter_notified_at'" "1" "0184 applies again after its down"
echo "==> 0184 product feedback reply notice and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0185: the search projection (ADR-0136). The full-text vector is
# generated with German stemming, so a plural finds the singular; the shelf key
# names its project or the office shelf and nothing else; what a Fassung changed
# keeps its keys and its entries to one length; a row goes with its document; the
# down drops both tables and 0185 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0185 search projection and its down migration on grid_documentsearch"
migrate_until grid_documentsearch 0185_document_search
sql_in grid_documentsearch <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000185', 'org_0185', 'Haus Wien', 'user_1', 'proj_0185');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000185', 'org_0185', 'user_1', 'bsk.pdf', 'k/0185/a', 'proj_0185', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000185');
INSERT INTO document_search_facets (document_id, organization_id, document_type, reference_tokens, fact_tokens, fact_numbers, search_text, fingerprint) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000185', 'org_0185', 'fire_safety_concept', '{"norm:önorm b 1600"}', '{"building_class=4"}',
   '{"building_class": 4}', 'Brandschutzkonzept · Fluchtwege und Stiegenhäuser', 'f1');
INSERT INTO document_search_shelves (organization_id, shelf_key, project_id, source_fingerprint, synced_at) VALUES
  ('org_0185', 'project:aaaaaaaa-0000-4000-8000-000000000185', 'aaaaaaaa-0000-4000-8000-000000000185', '1@x', now());
SQL
check_in grid_documentsearch "SELECT count(*) FROM document_search_facets WHERE search_vector @@ websearch_to_tsquery('german', 'Brandschutzkonzepte Fluchtweg')" "1" "0185: the German vector finds a plural and a singular"
check_in grid_documentsearch "SELECT count(*) FROM document_search_facets WHERE reference_tokens @> ARRAY['norm:önorm b 1600'] AND (fact_numbers->>'building_class')::numeric BETWEEN 3 AND 4" "1" "0185: a reference token and a numeric fact range"
refused_in grid_documentsearch "INSERT INTO document_search_facets (document_id, organization_id, fingerprint) VALUES ('d1d1d1d1-0000-4000-8000-000000000185', 'org_other', 'f2') ON CONFLICT (document_id) DO UPDATE SET organization_id = excluded.organization_id" "document_search_facets_document_tenant_fkey" "0185: a search row cannot move to another organization than its document's"
sql_in grid_documentsearch <<'SQL'
UPDATE document_search_facets SET changed_facts = '[{"key": "building_class", "before": "3", "after": "4", "page": 2}]', changed_fact_keys = '{building_class}'
  WHERE document_id = 'd1d1d1d1-0000-4000-8000-000000000185';
SQL
check_in grid_documentsearch "SELECT count(*) FROM document_search_facets WHERE changed_fact_keys && ARRAY['building_class', 'units'] AND cardinality(changed_fact_keys) > 0" "1" "0185: a changed fact is found by its key"
refused_in grid_documentsearch "UPDATE document_search_facets SET changed_fact_keys = '{}' WHERE document_id = 'd1d1d1d1-0000-4000-8000-000000000185'" "document_search_facets_changes_keyed" "0185: a change cannot lose its key, nor a key its change"
refused_in grid_documentsearch "UPDATE document_search_facets SET changed_facts = '{}', changed_fact_keys = '{}' WHERE document_id = 'd1d1d1d1-0000-4000-8000-000000000185'" "document_search_facets_changes_array" "0185: changed_facts is a list"
refused_in grid_documentsearch "INSERT INTO document_search_shelves (organization_id, shelf_key, project_id) VALUES ('org_0185', 'project:other', 'aaaaaaaa-0000-4000-8000-000000000185')" "document_search_shelves_key_shape" "0185: a shelf key names its own project"
sql_in grid_documentsearch <<'SQL'
DELETE FROM documents WHERE id = 'd1d1d1d1-0000-4000-8000-000000000185';
SQL
check_in grid_documentsearch "SELECT count(*) FROM document_search_facets" "0" "0185: a search row goes with its document"
apply_in grid_documentsearch 0185_document_search.down.sql
check_in grid_documentsearch "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('document_search_facets', 'document_search_shelves')" "0" "0185 down drops both tables"
apply_in grid_documentsearch 0185_document_search.sql
check_in grid_documentsearch "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('document_search_facets', 'document_search_shelves')" "2" "0185 applies again after its down"
echo "==> 0185 search projection and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0186: saved searches (ADR-0136, slice 5). A saved search holds a
# question, never an answer: scope and query are objects, the query is bounded,
# a name is 1 to 120 characters and unique per owner (two owners may share one
# name); the down drops the table and 0186 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0186 saved searches and their down migration on grid_savedsearch"
migrate_until grid_savedsearch 0186_saved_searches
sql_in grid_savedsearch <<'SQL'
INSERT INTO saved_searches (organization_id, owner_user_id, name, scope, query, shared) VALUES
  ('org_0186', 'user_a', 'Brandschutz', '{}', '{"text":"Brandschutzkonzept","kinds":["document"]}', true),
  ('org_0186', 'user_b', 'Brandschutz', '{"scope":"office_shelf"}', '{"text":"Brandschutz"}', false);
SQL
check_in grid_savedsearch "SELECT count(*) FROM saved_searches WHERE organization_id = 'org_0186' AND (owner_user_id = 'user_a' OR shared)" "1" "0186: user_a sees their own and the shared ones"
check_in grid_savedsearch "SELECT count(*) FROM saved_searches WHERE name = 'Brandschutz'" "2" "0186: two owners may use one name"
refused_in grid_savedsearch "INSERT INTO saved_searches (organization_id, owner_user_id, name, scope, query) VALUES ('org_0186', 'user_a', 'Brandschutz', '{}', '{}')" "saved_searches_owner_name_key" "0186: a name is unique per owner"
refused_in grid_savedsearch "INSERT INTO saved_searches (organization_id, owner_user_id, name, scope, query) VALUES ('org_0186', 'user_a', '', '{}', '{}')" "saved_searches_name_bounded" "0186: a name is not empty"
refused_in grid_savedsearch "INSERT INTO saved_searches (organization_id, owner_user_id, name, scope, query) VALUES ('org_0186', 'user_a', 'Liste', '{}', '[]')" "saved_searches_query_object" "0186: the query is an object"
refused_in grid_savedsearch "INSERT INTO saved_searches (organization_id, owner_user_id, name, scope, query) VALUES ('org_0186', 'user_a', 'Gross', '{}', jsonb_build_object('text', repeat('x', 16000)))" "saved_searches_query_bounded" "0186: the query is bounded"
apply_in grid_savedsearch 0186_saved_searches.down.sql
check_in grid_savedsearch "SELECT count(*) FROM information_schema.tables WHERE table_name = 'saved_searches'" "0" "0186 down drops the table"
apply_in grid_savedsearch 0186_saved_searches.sql
check_in grid_savedsearch "SELECT count(*) FROM information_schema.tables WHERE table_name = 'saved_searches'" "1" "0186 applies again after its down"
echo "==> 0186 saved searches and down migration verified"

# ---------------------------------------------------------------------------
# Migrations 0159 to 0162: the project profile's names in English, and their DOWNs.
#
# On a database of its own, migrated to what precedes 0159, with a project whose
# profile, prompt view, dismissed values, building bindings, proposed patch and
# permit record all hold the German names. Each migration rewrites its own table;
# a second run changes nothing; the down restores the German names.
# ---------------------------------------------------------------------------
echo "==> verifying the 0159-0162 English profile names and their down migrations on grid_profile_names"
migrate_before grid_profile_names 0159_english_profile_names
sql_in grid_profile_names <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name, profile, profile_prompt_view, profile_version) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000159', 'org_0159', 'Haus Wien', 'user_1', 'proj_0159',
   '{"facts":{"bundesland":{"value":"wien","confidence":"confirmed","source":"onboarding","updatedAt":"x"},
              "nutzungen@bw1":{"value":["wohnen","buero"],"confidence":"confirmed","source":"onboarding","updatedAt":"x"},
              "wohneinheiten@bw1@wohnen":{"value":4,"confidence":"confirmed","source":"onboarding","updatedAt":"x"},
              "gebaeudeklasse@bw1":{"value":3,"confidence":"confirmed","source":"derivation","updatedAt":"x",
                "evidence":[{"kind":"derivation","rule":"gebaeudeklasse","inputs":[{"key":"geschosse_oberirdisch@bw1","value":3},{"key":"nutzungen@bw1","value":["wohnen"]}]}]},
              "bauweise@bw1":{"value":["holzbau","offen"],"confidence":"confirmed","source":"onboarding","updatedAt":"x"},
              "project_name":{"value":"Haus","confidence":"confirmed","source":"onboarding","updatedAt":"x"},
              "agent_key":{"value":"wien","confidence":"confirmed","source":"onboarding","updatedAt":"x"}},
     "goals":{}, "unknowns":["bgf_oberirdisch@bw1"],
     "assumptions":{"erschliessung":{"value":"ja","confidence":"assumed","source":"onboarding","updatedAt":"x"}}}',
   E'PROJECT_CONTEXT v1\n\nconfirmed:\n- bundesland=wien\n- nutzungen@bw1=wohnen,buero\n- agent_key=wien\n\nunknown:\n- bgf_oberirdisch@bw1\n\nassumptions:\n- erschliessung=ja', 5),
  ('bbbbbbbb-0000-4000-8000-000000000159', 'org_0159', 'Leer', 'user_1', 'proj_0159b',
   '{"facts":{},"goals":{},"unknowns":[],"assumptions":{}}', NULL, 1);
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000159', 'org_0159', 'user_1', 'a.pdf', 'k/0159/a', 'proj_0159', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000159'),
  ('d2d2d2d2-0000-4000-8000-000000000159', 'org_0159', 'user_1', 'b.pdf', 'k/0159/b', 'proj_0159', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000159');
INSERT INTO document_roles (organization_id, project_id, document_id, role, scope_instance_id, created_by) VALUES
  ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd1d1d1d1-0000-4000-8000-000000000159', 'drawing', 'bw1', 'user_1'),
  ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd2d2d2d2-0000-4000-8000-000000000159', 'drawing', 'bw2', 'user_1'),
  ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd2d2d2d2-0000-4000-8000-000000000159', 'drawing', 'bldg2', 'user_1'),
  ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd2d2d2d2-0000-4000-8000-000000000159', 'site_plan', NULL, 'user_1');
INSERT INTO project_intakes (organization_id, project_id, created_by, dismissed, location) VALUES
  ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'user_1',
   '[{"key":"bundesland","value":"niederoesterreich"},{"key":"nutzungen@bw1","value":["wohnen"]}]',
   '{"bundesland":"tirol","gemeinde":"Innsbruck","lat":47.2}');
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES
  ('e1e1e1e1-0000-4000-8000-000000000159', 'org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'project', 'project_profile',
   '{"title":"t","patch":[{"op":"add","path":"/facts/bundesland","value":{"value":"tirol","confidence":"confirmed"}},
                          {"op":"replace","path":"/facts/nutzungen@bw1/value","value":["wohnen","buero"]},
                          {"op":"add","path":"/unknowns/-","value":"geschosse_oberirdisch@bw1"}]}', 'piloti', 'user_1'),
  ('e2e2e2e2-0000-4000-8000-000000000159', 'org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'project', 'memory',
   '{"patch":[{"path":"/facts/bundesland"}]}', 'piloti', 'user_1');
INSERT INTO permit_records (id, organization_id, project_id, document_id, collection_name, file_name, kind, bundesland, model) VALUES
  ('f1f1f1f1-0000-4000-8000-000000000159', 'org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd1d1d1d1-0000-4000-8000-000000000159',
   'proj_0159', 'a.pdf', 'bewilligung', 'niederoesterreich', 'm');
SQL

PROFILE_0159="SELECT profile::text || ' v' || profile_version FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'"
before_0159=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_profile_names -tAc "$PROFILE_0159")
before_view_0159=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d grid_profile_names -tAc "SELECT profile_prompt_view FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'")

apply_in grid_profile_names 0159_english_profile_names.sql
check_in grid_profile_names "SELECT string_agg(k, ',' ORDER BY k) FROM projects, jsonb_object_keys(profile->'facts') k WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" \
  "agent_key,building_class@bldg1,construction_method@bldg1,dwelling_units@bldg1@residential,federal_state,project_name,uses@bldg1" \
  "0159 renames the fact keys, the building id and the use zone; a key it does not know stays"
check_in grid_profile_names "SELECT profile->'facts'->'federal_state'->>'value' || '|' || (profile->'facts'->'uses@bldg1'->>'value') || '|' || (profile->'facts'->'construction_method@bldg1'->>'value') || '|' || (profile->'facts'->'agent_key'->>'value') FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" \
  'vienna|["residential", "office"]|["timber", "open"]|wien' \
  "0159 renames the tokens under the key they sit under, and not the same word under a key it does not know"
check_in grid_profile_names "SELECT profile->'facts'->'building_class@bldg1'->'evidence'->0->>'rule' || '|' || (profile->'facts'->'building_class@bldg1'->'evidence'->0->'inputs'->0->>'key') || '|' || (profile->'facts'->'building_class@bldg1'->'evidence'->0->'inputs'->1->'value'->>0) FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" \
  "building_class|storeys_above_ground@bldg1|residential" "0159 renames a derivation's rule, its input keys and their values"
check_in grid_profile_names "SELECT profile->'unknowns'->>0 || '|' || (profile->'assumptions'->'servicing'->>'value') FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" \
  "gfa_above_ground@bldg1|yes" "0159 renames an unknown and an assumption (ja is yes only for servicing)"
check_in grid_profile_names "SELECT profile_prompt_view FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" \
  $'PROJECT_CONTEXT v1\n\nconfirmed:\n- federal_state=vienna\n- uses@bldg1=residential,office\n- agent_key=wien\n\nunknown:\n- gfa_above_ground@bldg1\n\nassumptions:\n- servicing=yes' \
  "0159 rewrites the prompt view the agent parses, line by line"
check_in grid_profile_names "SELECT profile_version FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" "6" "0159 bumps profile_version so an open wizard reloads"
check_in grid_profile_names "SELECT profile_version FROM projects WHERE id = 'bbbbbbbb-0000-4000-8000-000000000159'" "1" "0159 leaves a profile without German names alone"
apply_in grid_profile_names 0159_english_profile_names.sql
check_in grid_profile_names "SELECT profile_version FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" "6" "0159 re-applies without a second bump"

apply_in grid_profile_names 0160_english_intake_names.sql
check_in grid_profile_names "SELECT dismissed::text FROM project_intakes" \
  '[{"key": "federal_state", "value": "lower_austria"}, {"key": "uses@bldg1", "value": ["residential"]}]' "0160 renames a dismissed key and value"
check_in grid_profile_names "SELECT location::text FROM project_intakes" \
  '{"lat": 47.2, "federalState": "tyrol", "municipality": "Innsbruck"}' "0160 renames the location's fields and the Land's token"
apply_in grid_profile_names 0160_english_intake_names.sql

apply_in grid_profile_names 0161_english_building_ids.sql
check_in grid_profile_names "SELECT string_agg(coalesce(scope_instance_id, '-') || ':' || role, ',' ORDER BY scope_instance_id, role) FROM document_roles" \
  "bldg1:drawing,bldg2:drawing,-:site_plan" \
  "0161 renames the building id of a binding, and drops the German duplicate of a binding that already exists in English"
check_in grid_profile_names "SELECT payload->'patch'->0->>'path' || '|' || (payload->'patch'->0->'value'->>'value') || '|' || (payload->'patch'->1->>'path') || '|' || (payload->'patch'->2->>'value') FROM proposed_changes WHERE kind = 'project_profile'" \
  "/facts/federal_state|tyrol|/facts/uses@bldg1/value|storeys_above_ground@bldg1" "0161 renames a proposed profile patch's paths and values"
check_in grid_profile_names "SELECT payload::text FROM proposed_changes WHERE kind = 'memory'" '{"patch": [{"path": "/facts/bundesland"}]}' "0161 leaves a proposal of another kind alone"
apply_in grid_profile_names 0161_english_building_ids.sql
check_in grid_profile_names "SELECT count(*) FROM document_roles" "3" "0161 re-applies without losing a binding"

apply_in grid_profile_names 0162_permit_federal_state.sql
check_in grid_profile_names "SELECT bundesland || '|' || federal_state FROM permit_records" "niederoesterreich|lower_austria" "0162 backfills federal_state with the English token and keeps bundesland"
sql_in grid_profile_names <<'SQL'
INSERT INTO permit_records (organization_id, project_id, document_id, collection_name, file_name, kind, federal_state, model)
VALUES ('org_0159', 'aaaaaaaa-0000-4000-8000-000000000159', 'd2d2d2d2-0000-4000-8000-000000000159', 'proj_0159', 'b.pdf', 'bewilligung', 'styria', 'm');
SQL
check_in grid_profile_names "SELECT bundesland || '|' || federal_state FROM permit_records WHERE file_name = 'b.pdf'" "steiermark|styria" "0162: a new pod's write fills the old column, so an older pod reads it"
sql_in grid_profile_names <<<"UPDATE permit_records SET bundesland = 'tirol' WHERE file_name = 'a.pdf'"
check_in grid_profile_names "SELECT federal_state FROM permit_records WHERE file_name = 'a.pdf'" "tyrol" "0162: an older pod's write fills the new column"
apply_in grid_profile_names 0162_permit_federal_state.sql

apply_in grid_profile_names 0162_permit_federal_state.down.sql
check_in grid_profile_names "SELECT count(*) FROM information_schema.columns WHERE table_name = 'permit_records' AND column_name IN ('federal_state', 'bundesland')" "1" "0162 down drops the English column and keeps bundesland"
check_in grid_profile_names "SELECT string_agg(file_name || ':' || bundesland, ',' ORDER BY file_name) FROM permit_records" "a.pdf:tirol,b.pdf:steiermark" "0162 down leaves the German tokens, as the trigger kept them"
apply_in grid_profile_names 0161_english_building_ids.down.sql
check_in grid_profile_names "SELECT string_agg(coalesce(scope_instance_id, '-') || ':' || role, ',' ORDER BY scope_instance_id, role) FROM document_roles" "bw1:drawing,bw2:drawing,-:site_plan" "0161 down restores the bwN building ids"
check_in grid_profile_names "SELECT payload->'patch'->0->>'path' || '|' || (payload->'patch'->1->>'path') FROM proposed_changes WHERE kind = 'project_profile'" "/facts/bundesland|/facts/nutzungen@bw1/value" "0161 down restores the patch paths"
apply_in grid_profile_names 0160_english_intake_names.down.sql
check_in grid_profile_names "SELECT dismissed::text || location::text FROM project_intakes" \
  '[{"key": "bundesland", "value": "niederoesterreich"}, {"key": "nutzungen@bw1", "value": ["wohnen"]}]{"lat": 47.2, "gemeinde": "Innsbruck", "bundesland": "tirol"}' "0160 down restores the German dismissed values and location"
apply_in grid_profile_names 0159_english_profile_names.down.sql
check_in grid_profile_names "$PROFILE_0159" "${before_0159%% v*} v7" "0159 down restores the profile exactly (its version moves forward, never back)"
check_in grid_profile_names "SELECT profile_prompt_view FROM projects WHERE id = 'aaaaaaaa-0000-4000-8000-000000000159'" "$before_view_0159" "0159 down restores the prompt view exactly"
echo "==> 0159-0162 English profile names and down migrations verified"

# ---------------------------------------------------------------------------
# Migrations 0170 and 0171: the office shelf's scope value is `office_shelf`,
# and the DOWN.
#
# On a database of its own, migrated to whatever precedes 0170. An office-shelf
# folder with a child, a document filed in the child, a project document, an
# upload batch and a proposal on the shelf, an access-log entry and a quarantine
# decision under the old value. 0170 rewrites the four mutable tables (and the
# composite keys between documents and folders survive the rewrite), refuses the
# old value in their new CHECKs, and leaves the two immutable tables alone; 0171
# makes those accept both spellings. The down puts the old value back; the up
# re-applies twice.
# ---------------------------------------------------------------------------
echo "==> verifying the 0170/0171 office shelf scope and its down migrations on grid_shelfscope"
migrate_before grid_shelfscope 0170_office_shelf_scope
sql_in grid_shelfscope <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000170', 'org_0170', 'Scope 0170', 'user_1', 'proj_0170');
INSERT INTO project_folders (id, organization_id, scope, name, path) VALUES
  ('f1f1f1f1-0000-4000-8000-000000000170', 'org_0170', 'archiv', 'Normen', 'Normen');
INSERT INTO project_folders (id, organization_id, scope, parent_id, name, path) VALUES
  ('f2f2f2f2-0000-4000-8000-000000000170', 'org_0170', 'archiv', 'f1f1f1f1-0000-4000-8000-000000000170', 'OIB', 'Normen/OIB');
INSERT INTO project_folders (id, organization_id, project_id, name, path) VALUES
  ('f3f3f3f3-0000-4000-8000-000000000170', 'org_0170', 'aaaaaaaa-0000-4000-8000-000000000170', 'Plaene', 'Plaene');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, folder_id) VALUES
  ('d1d1d1d1-0000-4000-8000-000000000170', 'org_0170', 'user_1', 'norm.pdf', 'k/0170/norm', 'archiv_org_0170', 'completed', 'archiv', 'f2f2f2f2-0000-4000-8000-000000000170');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id) VALUES
  ('d2d2d2d2-0000-4000-8000-000000000170', 'org_0170', 'user_1', 'plan.pdf', 'k/0170/plan', 'proj_0170', 'completed', 'project', 'aaaaaaaa-0000-4000-8000-000000000170', 'f3f3f3f3-0000-4000-8000-000000000170');
INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count) VALUES
  ('b1b1b1b1-0000-4000-8000-000000000170', 'org_0170', 'user_1', 'archiv', 1);
INSERT INTO proposed_changes (id, organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of)
VALUES ('c1c1c1c1-0000-4000-8000-000000000170', 'org_0170', NULL, 'archiv', 'file_operation',
        '{"operation":"move","operations":[{"document":"norm.pdf","source":"office","target_folder":"Normen"}]}', 'piloti', 'user_1');
INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name)
VALUES ('org_0170', 'u', 'download', 'archiv', 'd1d1d1d1-0000-4000-8000-000000000170', 'norm.pdf');
INSERT INTO document_quarantine_decisions (id, organization_id, document_id, job_id, scope, filename, uploaded_by)
VALUES ('e1e1e1e1-0000-4000-8000-000000000170', 'org_0170', 'd1d1d1d1-0000-4000-8000-000000000170', 'job-0170', 'archiv', 'norm.pdf', 'u');
SQL
SCOPES_0170="SELECT (SELECT string_agg(scope, ',' ORDER BY id) FROM project_folders) || '|' || (SELECT string_agg(scope, ',' ORDER BY id) FROM documents) || '|' || (SELECT scope FROM upload_batches) || '|' || (SELECT scope FROM proposed_changes)"
apply_in grid_shelfscope 0170_office_shelf_scope.sql
check_in grid_shelfscope "$SCOPES_0170" "office_shelf,office_shelf,project|office_shelf,project|office_shelf|office_shelf" "0170 renames the scope on folders, documents, the upload batch and the proposal"
check_in grid_shelfscope "SELECT folder_id FROM documents WHERE id = 'd1d1d1d1-0000-4000-8000-000000000170'" "f2f2f2f2-0000-4000-8000-000000000170" "0170 keeps a document in its folder"
check_in grid_shelfscope "SELECT count(*) FROM pg_constraint WHERE conname IN ('documents_folder_id_organization_id_scope_fkey','project_folders_parent_id_organization_id_scope_fkey','documents_folder_requires_project','project_folders_scope_check','upload_batches_scope','proposed_changes_scope_known') AND convalidated" "6" "0170 brings back the six constraints it dropped, validated"
check_in grid_shelfscope "SELECT scope FROM document_access_log" "archiv" "0170 does not rewrite the immutable access log"
check_in grid_shelfscope "SELECT scope FROM document_quarantine_decisions" "archiv" "0170 does not rewrite the immutable quarantine decisions"
refused_in grid_shelfscope "INSERT INTO project_folders (organization_id, scope, name, path) VALUES ('org_0170', 'archiv', 'Alt', 'Alt');" "project_folders_scope_check" "the old shelf value on a folder"
refused_in grid_shelfscope "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count) VALUES (gen_random_uuid(), 'org_0170', 'u', 'archiv', 1);" "upload_batches_scope" "the old shelf value on an upload batch"
refused_in grid_shelfscope "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0170', NULL, 'archiv', 'file_operation', '{\"operation\":\"move\",\"operations\":[{\"document\":\"x.pdf\",\"source\":\"office\"}]}', 'piloti', 'user_1');" "proposed_changes_scope_known" "the old shelf value on a proposal"
refused_in grid_shelfscope "INSERT INTO proposed_changes (organization_id, project_id, scope, kind, payload, proposed_by_kind, on_behalf_of) VALUES ('org_0170', NULL, 'office_shelf', 'memory', '{}', 'piloti', 'user_1');" "proposed_changes_office_shelf_move" "a shelf proposal that is not a move still refused"
refused_in grid_shelfscope "UPDATE documents SET folder_id = 'f3f3f3f3-0000-4000-8000-000000000170' WHERE id = 'd1d1d1d1-0000-4000-8000-000000000170';" "documents_folder_id_organization_id_scope_fkey" "a shelf document in a project folder"
refused_in grid_shelfscope "INSERT INTO project_folders (organization_id, scope, parent_id, name, path) VALUES ('org_0170', 'office_shelf', 'f3f3f3f3-0000-4000-8000-000000000170', 'x', 'x');" "project_folders_parent_id_organization_id_scope_fkey" "a project folder as the parent of a shelf folder"
refused_in grid_shelfscope "INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name) VALUES ('org_0170', 'u', 'download', 'office_shelf', gen_random_uuid(), 'x');" "document_access_log_scope_check" "the new shelf value in the log before 0171"
apply_in grid_shelfscope 0171_office_shelf_scope_logs.sql
sql_in grid_shelfscope <<<"INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name) VALUES ('org_0170', 'u', 'download', 'office_shelf', gen_random_uuid(), 'neu.pdf');"
check_in grid_shelfscope "SELECT string_agg(scope, ',' ORDER BY document_name) FROM document_access_log" "office_shelf,archiv" "0171: the log holds the old entry and takes a new one"
refused_in grid_shelfscope "INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name) VALUES ('org_0170', 'u', 'download', 'regal', gen_random_uuid(), 'x');" "document_access_log_scope_check" "an unknown shelf value in the log"
sql_in grid_shelfscope <<<"INSERT INTO document_quarantine_decisions (organization_id, document_id, job_id, scope, filename, uploaded_by) VALUES ('org_0170', gen_random_uuid(), 'job-2', 'office_shelf', 'neu.pdf', 'u');"
apply_in grid_shelfscope 0171_office_shelf_scope_logs.sql
apply_in grid_shelfscope 0170_office_shelf_scope.sql
apply_in grid_shelfscope 0170_office_shelf_scope.sql
check_in grid_shelfscope "$SCOPES_0170" "office_shelf,office_shelf,project|office_shelf,project|office_shelf|office_shelf" "0170 re-applies, twice"
# The down of 0171 needs a log with no new-spelling row; the log is immutable, so it runs on a fresh database.
migrate_before grid_shelfscope_down 0171_office_shelf_scope_logs
apply_in grid_shelfscope_down 0171_office_shelf_scope_logs.sql
apply_in grid_shelfscope_down 0171_office_shelf_scope_logs.down.sql
refused_in grid_shelfscope_down "INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name) VALUES ('org_0170', 'u', 'download', 'office_shelf', gen_random_uuid(), 'x');" "document_access_log_scope_check" "0171 down takes the new value out of the log CHECK"
apply_in grid_shelfscope 0170_office_shelf_scope.down.sql
check_in grid_shelfscope "$(echo "$SCOPES_0170")" "archiv,archiv,project|archiv,project|archiv|archiv" "0170 down puts the old scope back on every mutable table"
refused_in grid_shelfscope "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count) VALUES (gen_random_uuid(), 'org_0170', 'u', 'office_shelf', 1);" "upload_batches_scope" "down: the new shelf value on an upload batch"
apply_in grid_shelfscope 0170_office_shelf_scope.sql
check_in grid_shelfscope "$SCOPES_0170" "office_shelf,office_shelf,project|office_shelf,project|office_shelf|office_shelf" "0170 re-applies after its down"
echo "==> 0170/0171 office shelf scope and down migrations verified"

# ---------------------------------------------------------------------------
# 0187: the office shelf's value inside stored JSON. A message whose citation,
# answered card and plan fence each name the `archiv` shelf beside a `note` and a
# `bookshelf` that merely hold the word, a task and a run that froze an `archiv`
# document, and a message already English. The up rewrites only the `shelf`
# pairs, a second run changes nothing, the down puts them back.
# ---------------------------------------------------------------------------
echo "==> verifying the 0187 office shelf in stored JSON and its down migration on shelfjson_0187"
migrate_before shelfjson_0187 0187_office_shelf_in_stored_json
sql_in shelfjson_0187 <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000187', 'org_0187', 'Shelf 0187', 'user_1', 'proj_0187');
INSERT INTO conversations (id, organization_id, created_by, project_id) VALUES ('s_0187', 'org_0187', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000187');
INSERT INTO messages (id, conversation_id, organization_id, role, content, metadata) VALUES
  ('a0000000-0000-4000-8000-000000000187', 's_0187', 'org_0187', 'assistant',
   E'Plan\n```plan_json\n{"documents": [{"name": "norm.pdf", "shelf" : "archiv"}]}\n```\nim archiv',
   '{"citations": {"sources": [{"kind": "office", "shelf": "archiv"}, {"kind": "project", "shelf": "project"}]}, "note": "archiv", "bookshelf": "archiv", "promptState": {"response": "approve {\"documents\":[{\"shelf\":\"archiv\"}]}"}}'),
  ('a0000000-0000-4000-8000-000000000188', 's_0187', 'org_0187', 'assistant', 'ok', '{"citations": {"sources": [{"shelf": "office_shelf"}]}}');
INSERT INTO tasks (id, organization_id, project_id, kind, title, plan, requester_user_id) VALUES
  ('eeeeeeee-0000-4000-8000-000000000187', 'org_0187', 'aaaaaaaa-0000-4000-8000-000000000187', 'document', 'Dokument',
   '{"prompt": "x", "skill": {}, "dataSources": null, "documents": {"basis": [{"name": "norm.pdf", "shelf": "archiv"}], "excluded": []}}', 'user_1');
INSERT INTO task_runs (organization_id, project_id, kind, title, plan, requester_user_id, trigger, status, skill_snapshot) VALUES
  ('org_0187', 'aaaaaaaa-0000-4000-8000-000000000187', 'document', 'Dokument',
   '{"prompt": "x", "skill": {}, "dataSources": null, "documents": {"basis": [], "excluded": [{"name": "norm.pdf", "shelf": "archiv"}]}}', 'user_1', 'delegated', 'succeeded', '{}');
SQL
SHELF_0187="SELECT md5((SELECT string_agg(content || coalesce(metadata::text, '-'), '|' ORDER BY id) FROM messages) || (SELECT plan::text FROM tasks) || (SELECT plan::text FROM task_runs))"
BEFORE_0187=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d shelfjson_0187 -tAc "$SHELF_0187")
apply_in shelfjson_0187 0187_office_shelf_in_stored_json.sql
check_in shelfjson_0187 "SELECT content FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000187'" $'Plan\n```plan_json\n{"documents": [{"name": "norm.pdf", "shelf" : "office_shelf"}]}\n```\nim archiv' "0187 rewrites the shelf in a plan fence, keeping its spacing, and not the prose"
check_in shelfjson_0187 "SELECT metadata::text FROM messages WHERE id = 'a0000000-0000-4000-8000-000000000187'" '{"note": "archiv", "bookshelf": "archiv", "citations": {"sources": [{"kind": "office", "shelf": "office_shelf"}, {"kind": "project", "shelf": "project"}]}, "promptState": {"response": "approve {\"documents\":[{\"shelf\":\"office_shelf\"}]}"}}' "0187 rewrites a citation's shelf and the answered card's reply, and nothing that is not a shelf"
check_in shelfjson_0187 "SELECT (plan #>> '{documents,basis,0,shelf}') || ',' || (SELECT plan #>> '{documents,excluded,0,shelf}' FROM task_runs) FROM tasks" "office_shelf,office_shelf" "0187 rewrites a task's and a run's documents"
check_in shelfjson_0187 "SELECT count(*) FROM messages WHERE metadata::text ~ '\"shelf\": \"archiv\"' OR content ~ '\"shelf\" ?: \"archiv\"'" "0" "0187 leaves no archiv shelf behind"
AFTER_0187=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d shelfjson_0187 -tAc "$SHELF_0187")
apply_in shelfjson_0187 0187_office_shelf_in_stored_json.sql
check_in shelfjson_0187 "$SHELF_0187" "$AFTER_0187" "0187 re-applied changes nothing"
apply_in shelfjson_0187 0187_office_shelf_in_stored_json.down.sql
check_in shelfjson_0187 "SELECT (plan #>> '{documents,basis,0,shelf}') FROM tasks" "archiv" "0187 down puts the old value back"
apply_in shelfjson_0187 0187_office_shelf_in_stored_json.sql
check_in shelfjson_0187 "$SHELF_0187" "$AFTER_0187" "0187 re-applies after its down"
[ "$BEFORE_0187" != "$AFTER_0187" ] || { echo "MIGRATION ASSERTION FAILED: 0187 changed nothing" >&2; exit 1; }
echo "==> 0187 office shelf in stored JSON and down migration verified"

# ---------------------------------------------------------------------------
# 0189: piloti_wakes, piloti_changes and piloti_asks become agent_* (ADR-0145
# rule 5). An ask written before the rename is kept; each table's constraints
# and indexes carry the new name; the old name is a view the runtime role
# reads and writes through, inside its own organization only; a second run
# changes nothing; the down puts the tables back under their old names.
# ---------------------------------------------------------------------------
echo "==> verifying the 0189 agent tables and their down migration on agents_0189"
migrate_before agents_0189 0189_agent_tables
sql_in agents_0189 <<'SQL'
INSERT INTO conversations (id, organization_id, created_by) VALUES
  ('conv_0189_a', 'org_0189_a', 'user_1'),
  ('conv_0189_b', 'org_0189_b', 'user_2');
INSERT INTO piloti_asks (id, organization_id, conversation_id, requested_by) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000189', 'org_0189_a', 'conv_0189_a', 'user_1'),
  ('b1b1b1b1-0000-4000-8000-000000000189', 'org_0189_b', 'conv_0189_b', 'user_2');
SQL
apply_in agents_0189 0189_agent_tables.sql
check_in agents_0189 "SELECT string_agg(relname || ':' || relkind::text, ',' ORDER BY relname) FROM pg_class WHERE relname ~ '^(piloti|agent)_(wakes|changes|asks)$'" "agent_asks:r,agent_changes:r,agent_wakes:r,piloti_asks:v,piloti_changes:v,piloti_wakes:v" "0189 renames the tables and leaves a view under each old name"
check_in agents_0189 "SELECT count(*) FROM agent_asks" "2" "0189 keeps the asks"
check_in agents_0189 "SELECT count(*) FROM pg_constraint WHERE conname ~ '^piloti_(wakes|changes|asks)_' AND contype <> 'n'" "0" "0189 leaves no constraint under an old name"
check_in agents_0189 "SELECT count(*) FROM pg_indexes WHERE indexname ~ '^idx_piloti_(wakes|changes|asks)_'" "0" "0189 leaves no index under an old name"
check_in agents_0189 "SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_agent_wakes_document_annotation_created', 'idx_agent_changes_origin', 'idx_agent_asks_conversation')" "3" "0189 renames the indexes by prefix"
refused_in agents_0189 "INSERT INTO agent_asks (id, organization_id, conversation_id, requested_by, state, ended_at) VALUES (gen_random_uuid(), 'org_0189_a', 'conv_0189_a', 'user_1', 'working', now())" "agent_asks_ended_when_terminal" "a running ask with an end, after the rename"
check_in agents_0189 "SELECT relrowsecurity FROM pg_class WHERE relname = 'agent_asks'" "t" "0189 keeps row-level security on"
RW189=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d agents_0189 -qtA -v ON_ERROR_STOP=1 \
  -c "SET grid.organization_id = 'org_0189_a'" \
  -c "INSERT INTO piloti_asks (id, organization_id, conversation_id, requested_by) VALUES ('c1c1c1c1-0000-4000-8000-000000000189', 'org_0189_a', 'conv_0189_a', 'user_1')" \
  -c "SELECT string_agg(id::text, ',' ORDER BY id) FROM piloti_asks")
if [ "$RW189" != "a1a1a1a1-0000-4000-8000-000000000189,c1c1c1c1-0000-4000-8000-000000000189" ]; then
  echo "MIGRATION ASSERTION FAILED on agents_0189: through the old name the runtime role saw or wrote outside its organization (got: $RW189)" >&2
  exit 1
fi
check_in agents_0189 "SELECT count(*) FROM agent_asks" "3" "0189: a write through the old name lands in the new table"
apply_in agents_0189 0189_agent_tables.sql
check_in agents_0189 "SELECT string_agg(relname || ':' || relkind::text, ',' ORDER BY relname) FROM pg_class WHERE relname ~ '^(piloti|agent)_(wakes|changes|asks)$'" "agent_asks:r,agent_changes:r,agent_wakes:r,piloti_asks:v,piloti_changes:v,piloti_wakes:v" "0189 re-applied changes nothing"
apply_in agents_0189 0189_agent_tables.down.sql
check_in agents_0189 "SELECT string_agg(relname || ':' || relkind::text, ',' ORDER BY relname) FROM pg_class WHERE relname ~ '^(piloti|agent)_(wakes|changes|asks)$'" "piloti_asks:r,piloti_changes:r,piloti_wakes:r" "0189 down puts the tables back under their old names"
check_in agents_0189 "SELECT count(*) FROM pg_constraint WHERE conname = 'piloti_asks_state_known'" "1" "0189 down puts the constraints back"
check_in agents_0189 "SELECT count(*) FROM piloti_asks" "3" "0189 down keeps the asks"
apply_in agents_0189 0189_agent_tables.sql
check_in agents_0189 "SELECT count(*) FROM agent_asks" "3" "0189 re-applies after its down"
echo "==> 0189 agent tables and down migration verified"

# ---------------------------------------------------------------------------
# 0190: the database's own functions lose the `grid_` prefix (ADR-0145 rule 5).
# Every `grid_` function is renamed; no body still calls a `grid_` function;
# each one that is not a trigger function answers under its old name too, with
# its grant (secure_table stays closed to the runtime role under both names);
# the new secure_table secures a table; a second run changes nothing; the down
# puts the old names back and drops the wrappers. The suites above ran against
# grid_app migrated through this, so every policy and trigger still works.
# ---------------------------------------------------------------------------
echo "==> verifying the 0190 function names and their down migration on functions_0190"
migrate_before functions_0190 0190_brand_free_functions
OLD_0190="SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^grid_' AND coalesce(obj_description(oid, 'pg_proc'), '') NOT LIKE 'Old name, kept for one release by migration 0190%'"
WRAPPERS_0190="SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND obj_description(oid, 'pg_proc') LIKE 'Old name, kept for one release by migration 0190%'"
CALLS_OLD_0190="SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname !~ '^grid_' AND prosrc ~ 'grid_[a-z_]+\('"
SHAPE_0190="SELECT md5(string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')' || prosrc || coalesce(proacl::text, ''), '|' ORDER BY proname, pg_get_function_identity_arguments(oid))) FROM pg_proc WHERE pronamespace = 'public'::regnamespace"
check_in functions_0190 "$OLD_0190" "30" "before 0190 the 30 functions carry the prefix"
apply_in functions_0190 0190_brand_free_functions.sql
check_in functions_0190 "$OLD_0190" "0" "0190 leaves no function under a grid_ name but its wrappers"
check_in functions_0190 "$CALLS_OLD_0190" "0" "0190 leaves no body calling a grid_ function"
check_in functions_0190 "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('secure_table', 'current_org', 'legal_hold_blocks', 'refuse_held_delete', 'uuid_or_null')" "5" "0190 names the functions without the brand"
check_in functions_0190 "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('grid_refuse_held_delete', 'grid_refuse_insert_into_closed_project')" "0" "0190 leaves no wrapper for a trigger function"
check_in functions_0190 "SELECT has_function_privilege('grid_app_rw', 'secure_table(text, text)', 'EXECUTE')::text || ',' || has_function_privilege('grid_app_rw', 'grid_secure_table(text, text)', 'EXECUTE')::text" "false,false" "secure_table stays closed to the runtime role under both names"
RW190=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U grid_app_rw -d functions_0190 -qtA -v ON_ERROR_STOP=1 \
  -c "SET grid.organization_id = 'org_0190'" \
  -c "SELECT current_org() || ',' || grid_current_org() || ',' || coalesce(uuid_or_null('x')::text, 'null') || ',' || coalesce(grid_uuid_or_null('x')::text, 'null')")
if [ "$RW190" != "org_0190,org_0190,null,null" ]; then
  echo "MIGRATION ASSERTION FAILED on functions_0190: the runtime role did not get the same answer under both names (got: $RW190)" >&2
  exit 1
fi
sql_in functions_0190 <<<"CREATE TABLE t_0190 (organization_id text); SELECT secure_table('t_0190', 'organization_id = current_org()');"
check_in functions_0190 "SELECT relrowsecurity FROM pg_class WHERE relname = 't_0190'" "t" "secure_table secures a table after 0190"
AFTER_0190=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U grid_app_owner -d functions_0190 -tAc "$SHAPE_0190")
apply_in functions_0190 0190_brand_free_functions.sql
check_in functions_0190 "$SHAPE_0190" "$AFTER_0190" "0190 re-applied changes nothing"
apply_in functions_0190 0190_brand_free_functions.down.sql
check_in functions_0190 "$OLD_0190" "30" "0190 down puts the 30 grid_ names back"
check_in functions_0190 "$WRAPPERS_0190" "0" "0190 down drops the wrappers"
check_in functions_0190 "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('secure_table', 'current_org', 'legal_hold_blocks')" "0" "0190 down leaves no brand-free name"
apply_in functions_0190 0190_brand_free_functions.sql
check_in functions_0190 "$SHAPE_0190" "$AFTER_0190" "0190 re-applies after its down to the same functions"
echo "==> 0190 function names and down migration verified"

# ---------------------------------------------------------------------------
# 0191: the policies lose `grid_`, and nothing the database runs names a role by
# its old name. On a database migrated to just before it, with a document access
# log row: the up renames every `grid_` policy (one `tenant_isolation` per secured
# table, the write guards), a second run changes nothing, and the down puts the
# old names back. Then the deploy's rename of the roles, after which
# `secure_table` grants to `app_rw` and the access log's guard still lets the
# platform role delete, now under its new name. The old names come back at the
# end, for nothing after this, as for the suites above.
# ---------------------------------------------------------------------------
echo "==> verifying the 0191 policy names and their down migration on policies_0191"
migrate_before policies_0191 0191_brand_free_policies
OLD_POLICIES_0191="SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND left(policyname, 5) = 'grid_'"
SHAPE_0191="SELECT string_agg(tablename || ':' || policyname, ',' ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'public'"
BEFORE_0191=$($PSQL -d policies_0191 -tAc "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")
apply_in policies_0191 0191_brand_free_policies.sql
check_in policies_0191 "$OLD_POLICIES_0191" "0" "0191 leaves no policy under a grid_ name"
check_in policies_0191 "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'" "$BEFORE_0191" "0191 renames policies and adds none"
check_in policies_0191 "SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity AND (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') <> 1" "0" "0191: every table under row-level security has exactly one tenant_isolation policy"
check_in policies_0191 "SELECT count(*) FROM pg_policies WHERE tablename = 'skill_categories' AND policyname LIKE 'tenant_write_guard%'" "3" "0191 renames the restrictive write guards"
check_in policies_0191 "SELECT count(*) FROM pg_proc WHERE proname IN ('document_access_log_guard', 'document_quarantine_decisions_guard') AND prosrc LIKE '%rls_role(''platform'')%'" "2" "0191 has the delete guards ask rls_role()"
AFTER_0191=$($PSQL -d policies_0191 -tAc "$SHAPE_0191")
apply_in policies_0191 0191_brand_free_policies.sql
check_in policies_0191 "$SHAPE_0191" "$AFTER_0191" "0191 re-applied changes nothing"
apply_in policies_0191 0191_brand_free_policies.down.sql
check_in policies_0191 "SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'" "0" "0191 down puts the grid_ policy names back"
check_in policies_0191 "SELECT count(*) FROM pg_proc WHERE proname = 'rls_role'" "0" "0191 down drops rls_role"
apply_in policies_0191 0191_brand_free_policies.sql
check_in policies_0191 "$SHAPE_0191" "$AFTER_0191" "0191 re-applies after its down"

echo "==> renaming the roles as the deploy does, then securing a table and deleting a log row as the platform role"
sql_in policies_0191 <<<"INSERT INTO document_access_log (organization_id, user_id, kind, scope, document_id, document_name) VALUES ('org_0191', 'user_1', 'download', 'session', gen_random_uuid(), 'a.pdf');"
rename_rls_roles
check_in policies_0191 "SELECT rls_role('rw') || ',' || rls_role('platform')" "app_rw,app_platform" "after the rename rls_role() answers the new names"
sql_in policies_0191 <<<"CREATE TABLE t_0191 (organization_id text); SELECT secure_table('t_0191', 'organization_id = current_org()');"
check_in policies_0191 "SELECT has_table_privilege('app_rw', 't_0191', 'INSERT')::text || ',' || (SELECT count(*) FROM pg_policies WHERE tablename = 't_0191' AND policyname = 'tenant_isolation')" "true,1" "secure_table grants to app_rw and installs one tenant_isolation after the rename"
RW191=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d policies_0191 -qtA -v ON_ERROR_STOP=1 \
  -c "BEGIN" -c "SET LOCAL ROLE app_platform" -c "DELETE FROM document_access_log" -c "SELECT current_user" -c "COMMIT")
check_in policies_0191 "SELECT count(*) FROM document_access_log" "0" "the platform role deleted the log row under its new name"
if [ "$RW191" != "app_platform" ]; then
  echo "MIGRATION ASSERTION FAILED on policies_0191: the platform role under its new name was refused by the access log's guard (got: $RW191)" >&2
  exit 1
fi
restore_rls_role_names
echo "==> 0191 policy names, the role rename and down migration verified"

# ---------------------------------------------------------------------------
# Migration 0195: what settling an upload batch sets off, per batch, and the
# DOWN.
#
# On a database of its own, migrated to whatever precedes 0195, with one batch
# opened before it. 0195 gives that batch, and any batch opened without naming
# them, every effect of a person's upload; it refuses an unknown revision
# notice; it re-applies. The down drops the five columns and the CHECK; the up
# re-applies after it. What the columns do is upload-batches.integration.spec.ts's
# and the unit specs'.
# ---------------------------------------------------------------------------
echo "==> verifying the 0195 upload batch effects and its down migration on batch_effects_0195"
migrate_before batch_effects_0195 0195_upload_batch_effects
sql_in batch_effects_0195 <<'SQL'
INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count) VALUES
  ('b1b1b1b1-0000-4000-8000-000000000185', 'org_0185', 'user_1', 'office_shelf', 1);
SQL
EFFECTS_0195="SELECT string_agg(announces_completion::text || ',' || reviews_filing::text || ',' || starts_intake::text || ',' || revision_notice || ',' || runs_document_check::text, '|' ORDER BY id) FROM upload_batches"
COLUMNS_0185="SELECT count(*) FROM information_schema.columns WHERE table_name = 'upload_batches' AND column_name IN ('announces_completion', 'reviews_filing', 'starts_intake', 'revision_notice', 'runs_document_check')"
apply_in batch_effects_0195 0195_upload_batch_effects.sql
check_in batch_effects_0195 "$EFFECTS_0195" "true,true,true,all,true" "0195 gives a batch opened before it every effect of a person's upload"
sql_in batch_effects_0195 <<'SQL'
INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000185', 'org_0185', 'user_1', 'office_shelf', 1);
INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count, announces_completion, reviews_filing, starts_intake, revision_notice, runs_document_check) VALUES
  ('b3b3b3b3-0000-4000-8000-000000000185', 'org_0185', 'user_1', 'office_shelf', 1, false, false, false, 'marks_only', false);
SQL
check_in batch_effects_0195 "$EFFECTS_0195" "true,true,true,all,true|true,true,true,all,true|false,false,false,marks_only,false" "0195: a batch that names no effect has all of them, a quiet one keeps what it set"
refused_in batch_effects_0195 "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count, revision_notice) VALUES (gen_random_uuid(), 'org_0185', 'u', 'office_shelf', 1, 'nobody');" "upload_batches_revision_notice_known" "an unknown revision notice"
refused_in batch_effects_0195 "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count, starts_intake) VALUES (gen_random_uuid(), 'org_0185', 'u', 'office_shelf', 1, NULL);" "starts_intake" "a batch with no answer to whether it starts an intake reading"
refused_in batch_effects_0195 "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count, runs_document_check) VALUES (gen_random_uuid(), 'org_0185', 'u', 'office_shelf', 1, NULL);" "runs_document_check" "a batch with no answer to whether its documents are checked"
apply_in batch_effects_0195 0195_upload_batch_effects.sql
check_in batch_effects_0195 "$EFFECTS_0195" "true,true,true,all,true|true,true,true,all,true|false,false,false,marks_only,false" "0195 re-applies and keeps what the batches hold"
apply_in batch_effects_0195 0195_upload_batch_effects.down.sql
check_in batch_effects_0195 "$COLUMNS_0185" "0" "0195 down drops the five columns"
check_in batch_effects_0195 "SELECT count(*) FROM pg_constraint WHERE conname = 'upload_batches_revision_notice_known'" "0" "0195 down drops the CHECK"
check_in batch_effects_0195 "SELECT count(*) FROM upload_batches" "3" "0195 down keeps every batch"
apply_in batch_effects_0195 0195_upload_batch_effects.down.sql
apply_in batch_effects_0195 0195_upload_batch_effects.sql
check_in batch_effects_0195 "$EFFECTS_0195" "true,true,true,all,true|true,true,true,all,true|true,true,true,all,true" "0195 re-applies after its down, every batch back to a person's upload"
refused_in batch_effects_0195 "INSERT INTO upload_batches (id, organization_id, created_by, scope, expected_count, revision_notice) VALUES (gen_random_uuid(), 'org_0185', 'u', 'office_shelf', 1, 'nobody');" "upload_batches_revision_notice_known" "after the re-apply: an unknown revision notice"
echo "==> 0195 upload batch effects and its down migration verified"

# ---------------------------------------------------------------------------
# Migration 0196: inbound mail, mail threads and follows (ADR-0137), and the
# DOWN.
#
# On a database of its own, migrated through 0196, with two organizations and
# a third project of the first one that a legal hold will cover. Every refusal
# 0196 promises is a violating statement here, named by its constraint:
# nothing is filed without a person's file decision, a system actor never
# decides, an agent's card and a follow carry no acknowledgement, a follow is the
# follower's own, nothing unscanned is shown or filed, a settled mail keeps no
# third party's data, every object key is the row's own. Then what the runtime
# role may do (its organization only, never a DELETE), what a decision may
# become (audited, once), what a hold stops, what deleting a document, a
# thread and a project takes along, and the down: refused while a row names an
# object, clean once none does, and 0196 applies again after it.
#
# What the repository, the jobs and the sweeps do with these rows is their own
# integration specs' (registered above); this section is what the database
# alone guarantees.
# ---------------------------------------------------------------------------
echo "==> verifying the 0196 inbound mail, threads and follows and their down migration on inbound_0196"
migrate_until inbound_0196 0196_inbound_mail
# People are WorkOS user ids: the tables refuse every other shape.
U184_A1="user_01J0MA1LUSERA00000000000A1"
U184_A2="user_01J0MA1LUSERA00000000000A2"
sql_in inbound_0196 <<'SQL'
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('a0000000-0000-4000-8000-000000000184', 'org_0184_a', 'Mail A', 'user_01J0MA1LUSERA00000000000A1', 'proj_0184_a'),
  ('b0000000-0000-4000-8000-000000000184', 'org_0184_b', 'Mail B', 'user_01J0MA1LUSERB00000000000B1', 'proj_0184_b'),
  ('c0000000-0000-4000-8000-000000000184', 'org_0184_a', 'Mail held', 'user_01J0MA1LUSERA00000000000A1', 'proj_0184_h');
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id) VALUES
  ('d1000000-0000-4000-8000-000000000184', 'org_0184_a', 'user_01J0MA1LUSERA00000000000A1', 'Verlauf.md', 'k/0196/a', 'proj_0184_a', 'completed', 'project', 'a0000000-0000-4000-8000-000000000184'),
  ('d3000000-0000-4000-8000-000000000184', 'org_0184_b', 'user_01J0MA1LUSERB00000000000B1', 'Plan.pdf', 'k/0196/b', 'proj_0184_b', 'completed', 'project', 'b0000000-0000-4000-8000-000000000184');
INSERT INTO inbound_mail_addresses (id, organization_id, project_id, token, slug, created_by) VALUES
  ('aa000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'aaaaaaaaaaaa', 'mail-a', 'user_01J0MA1LUSERA00000000000A1'),
  ('ab000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'bbbbbbbbbbbb', 'mail-b', 'user_01J0MA1LUSERB00000000000B1'),
  ('ac000000-0000-4000-8000-000000000184', 'org_0184_a', 'c0000000-0000-4000-8000-000000000184', 'cccccccccccc', '', 'user_01J0MA1LUSERA00000000000A1');
INSERT INTO mail_threads (id, organization_id, project_id, document_id, base_subject, participant_domains, locale, created_by) VALUES
  ('ea000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'd1000000-0000-4000-8000-000000000184', 'Statik Dach', '{statik.at}', 'de', 'user_01J0MA1LUSERA00000000000A1'),
  ('eb000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', NULL, 'Plan', '{}', 'en', 'user_01J0MA1LUSERB00000000000B1'),
  ('ec000000-0000-4000-8000-000000000184', 'org_0184_a', 'c0000000-0000-4000-8000-000000000184', NULL, 'Gehalten', '{}', 'de', 'user_01J0MA1LUSERA00000000000A1'),
  ('ed000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', NULL, 'Archiv', '{}', 'de', 'user_01J0MA1LUSERA00000000000A1');
INSERT INTO mail_thread_follows (id, organization_id, project_id, thread_id, user_id, expires_at) VALUES
  ('fa000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'user_01J0MA1LUSERA00000000000A1', now() + interval '60 days'),
  ('fb000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'eb000000-0000-4000-8000-000000000184', 'user_01J0MA1LUSERB00000000000B1', now() + interval '60 days');
INSERT INTO mail_thread_entries (id, organization_id, project_id, thread_id, source, inbound_mail_id, message_id, sent_at, received_at, heading, sender_trust, own_text, filed_by, filed_via,
                                 original_bucket, original_storage_key, original_sha256, original_bytes, original_scan_status) VALUES
  ('e1000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'inbound', '1a000000-0000-4000-8000-000000000184', 'm1@statik.at', now() - interval '1 day', now(), '21.10.2026 09:00 · Huber (statik.at)', 'external_verified', 'Die Bewehrung passt.', 'user_01J0MA1LUSERA00000000000A1', 'app',
   'grid-org-a', 'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_mail-originals/e1000000-0000-4000-8000-000000000184.eml', repeat('a', 64), 2048, 'clean'),
  ('e3000000-0000-4000-8000-000000000184', 'org_0184_a', 'c0000000-0000-4000-8000-000000000184', 'ec000000-0000-4000-8000-000000000184', 'inbound', '1c000000-0000-4000-8000-000000000184', 'm3@statik.at', now() - interval '1 day', now(), '21.10.2026 09:00 · Huber (statik.at)', 'external_verified', 'Gehalten.', 'user_01J0MA1LUSERA00000000000A1', 'app',
   NULL, NULL, NULL, NULL, NULL),
  ('e4000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'eb000000-0000-4000-8000-000000000184', 'inbound', '1b000000-0000-4000-8000-000000000184', 'm4@b.at', now() - interval '1 day', now(), '21.10.2026 09:00 · X (b.at, Domain nicht bestätigt)', 'external_unverified', 'B.', 'user_01J0MA1LUSERB00000000000B1', 'app',
   NULL, NULL, NULL, NULL, NULL);
INSERT INTO mail_thread_entries (id, organization_id, project_id, thread_id, source, mail_import_id, message_id, sent_at, received_at, heading, sender_trust, filed_by, filed_via) VALUES
  ('e2000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'archive', '9a000000-0000-4000-8000-000000000184', 'm0@buero.at', now() - interval '9 days', now() - interval '9 days', '12.10.2026 10:00 · Mayer (buero.at, aus dem Outlook-Archiv)', 'not_checked', 'user_01J0MA1LUSERA00000000000A1', 'archive_import');
INSERT INTO mail_thread_message_ids (organization_id, project_id, thread_id, message_id, state, entry_id) VALUES
  ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'm1@statik.at', 'received', 'e1000000-0000-4000-8000-000000000184'),
  ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'm0@buero.at', 'referenced', 'e1000000-0000-4000-8000-000000000184'),
  ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ea000000-0000-4000-8000-000000000184', 'm0@buero.at', 'received', 'e2000000-0000-4000-8000-000000000184'),
  ('org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'eb000000-0000-4000-8000-000000000184', 'm4@b.at', 'received', 'e4000000-0000-4000-8000-000000000184');
-- Three waiting mails: one per project, each scanned whole and checked.
INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_storage_key, read_storage_key,
                           raw_scan_status, raw_scanned_at, message_id, sender_address, subject, sender_trust, sender_reason, signed_headers, expires_at) VALUES
  ('1a000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'aa000000-0000-4000-8000-000000000184', 'waiting', repeat('1', 64), 4096, 'grid-org-a',
   'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184/raw.eml',
   'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184/read.json',
   'clean', now(), 'm2@statik.at', 'huber@statik.at', 'AW: Statik Dach', 'external_verified', 'dkim_pass', '{from,subject,date,message-id,references}', now() + interval '30 days'),
  ('1b000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'ab000000-0000-4000-8000-000000000184', 'waiting', repeat('2', 64), 4096, 'grid-org-b',
   NULL, NULL, 'clean', now(), NULL, 'x@b.at', 'Plan', 'external_unverified', 'dkim_none', '{}', now() + interval '30 days'),
  ('1c000000-0000-4000-8000-000000000184', 'org_0184_a', 'c0000000-0000-4000-8000-000000000184', 'ac000000-0000-4000-8000-000000000184', 'waiting', repeat('3', 64), 4096, 'grid-org-a',
   NULL, NULL, 'clean', now(), NULL, 'x@h.at', 'Held', 'external_unverified', 'dkim_none', '{}', now() + interval '30 days');
INSERT INTO inbound_mail_parts (id, organization_id, project_id, mail_id, position, kind, filename, content_type, size_bytes, sha256, storage_key, scan_status, scanned_at) VALUES
  ('2a000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', '1a000000-0000-4000-8000-000000000184', 0, 'message', NULL, 'text/plain', 120, repeat('a', 64), NULL, 'not_applicable', NULL),
  ('2b000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', '1a000000-0000-4000-8000-000000000184', 1, 'attachment', 'S-101.pdf', 'application/pdf', 2048, repeat('b', 64),
   'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184/1', 'clean', now()),
  ('2c000000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', '1b000000-0000-4000-8000-000000000184', 0, 'message', NULL, 'text/plain', 10, repeat('c', 64), NULL, 'not_applicable', NULL),
  ('2d000000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', '1a000000-0000-4000-8000-000000000184', 2, 'attachment', 'Rechnung.docm', 'application/vnd.ms-word.document.macroEnabled.12', 512, repeat('d', 64),
   'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184/2', 'pending', NULL);
INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by) VALUES
  ('org_0184_b', 'b0000000-0000-4000-8000-000000000184', '1b000000-0000-4000-8000-000000000184', '2c000000-0000-4000-8000-000000000184', 'dismiss', 'user_01J0MA1LUSERB00000000000B1');
SQL
check_in inbound_0196 "SELECT count(*) FROM inbound_mail_parts WHERE state = 'waiting'" "4" "0196: parts wait for a person"

# Insert prefixes for the violating rows below. Each refusal names its rule; a
# trigger's refusal carries its rule as the error's constraint name, which psql
# prints only when verbose ($V184).
V184=$'\\set VERBOSITY verbose\n'
PA184="'org_0184_a', 'a0000000-0000-4000-8000-000000000184'"
ADDR184="INSERT INTO inbound_mail_addresses (organization_id, project_id, token, slug, created_by, revoked_at, revoked_by, revoked_reason) VALUES ($PA184"
MAIL184="INSERT INTO inbound_mails (organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, sender_address, sender_trust, sender_user_id, sender_flags, authentication_results, dropped_reason, subject, expires_at, sender_reason) VALUES ($PA184, 'aa000000-0000-4000-8000-000000000184'"
PART184="INSERT INTO inbound_mail_parts (organization_id, project_id, mail_id, position, kind, filename, content_type, size_bytes, sha256, storage_key, scan_status, scanned_at, risk_flags, name_stop_terms) VALUES ($PA184, '1a000000-0000-4000-8000-000000000184'"
KEY184="'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184"
DEC184="INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, via, proposal_id, follow_id, folder_path, thread_action, mail_thread_id, message_text, file_name, screening_release, acknowledged_sender, acknowledged_risk) VALUES ($PA184, '1a000000-0000-4000-8000-000000000184'"
THREAD184="INSERT INTO mail_threads (organization_id, project_id, document_id, base_subject, locale, created_by) VALUES ($PA184"
ENTRY184="INSERT INTO mail_thread_entries (organization_id, project_id, thread_id, source, inbound_mail_id, mail_import_id, sent_at, received_at, heading, sender_trust, filed_by, filed_via, authentication_results, original_bucket, original_storage_key, original_sha256, original_bytes, original_scan_status) VALUES ($PA184, 'ea000000-0000-4000-8000-000000000184'"
FOLLOW184="INSERT INTO mail_thread_follows (organization_id, project_id, thread_id, user_id, created_at, expires_at, ended_at, ended_by, ended_reason) VALUES ($PA184, 'ea000000-0000-4000-8000-000000000184'"

# Addresses: the token's shape, global and never reused, one active per project.
refused_in inbound_0196 "$ADDR184, 'AAAAAAAAAAAA', '', '$U184_A1', NULL, NULL, NULL)" "inbound_mail_addresses_token_shape" "a token that is not lowercase base32"
refused_in inbound_0196 "$ADDR184, 'dddddddddddd', 'a.b', '$U184_A1', NULL, NULL, NULL)" "inbound_mail_addresses_slug_shape" "a slug with a dot"
refused_in inbound_0196 "$ADDR184, 'dddddddddddd', '', '$U184_A1', now(), NULL, 'rotated')" "inbound_mail_addresses_revocation_attributed" "a revocation nobody made"
refused_in inbound_0196 "$ADDR184, 'dddddddddddd', '', '$U184_A1', now(), '$U184_A1', 'lost')" "inbound_mail_addresses_revoked_reason_known" "an unknown revocation reason"
refused_in inbound_0196 "UPDATE inbound_mail_addresses SET cap_notice = 'overflowing', cap_noticed_at = now() WHERE id = 'aa000000-0000-4000-8000-000000000184'" "inbound_mail_addresses_cap_notice_known" "a cap notice the sweep does not know"
refused_in inbound_0196 "UPDATE inbound_mail_addresses SET cap_notice = 'full' WHERE id = 'aa000000-0000-4000-8000-000000000184'" "inbound_mail_addresses_cap_noticed_at" "a cap notice without when it was told"
refused_in inbound_0196 "$ADDR184, 'dddddddddddd', '', '$U184_A1', NULL, NULL, NULL)" "uniq_inbound_mail_addresses_active_project" "a second active address for a project"
sql_in inbound_0196 <<<"UPDATE inbound_mail_addresses SET revoked_at = now(), revoked_by = '$U184_A1', revoked_reason = 'rotated' WHERE id = 'ac000000-0000-4000-8000-000000000184';"
refused_in inbound_0196 "INSERT INTO inbound_mail_addresses (organization_id, project_id, token, created_by) VALUES ('org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'cccccccccccc', 'u')" "uniq_inbound_mail_addresses_token" "a revoked token minted again, even in another organization"
refused_in inbound_0196 "INSERT INTO inbound_mail_addresses (organization_id, project_id, token, created_by) VALUES ('org_0184_b', 'c0000000-0000-4000-8000-000000000184', 'dddddddddddd', 'u')" "inbound_mail_addresses_project_fkey" "an address on another organization's project"

# Mails: idempotent per address, scanned before shown, the verdict's shape, the scrub.
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('1', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "uniq_inbound_mails_address_delivery" "the same delivery twice to one address"
refused_in inbound_0196 "$MAIL184, 'queued', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_status_known" "an unknown status"
refused_in inbound_0196 "$MAIL184, 'received', NULL, 1, 'b', 'pending', NULL, NULL, NULL, NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', NULL)" "inbound_mails_delivery_key_when_received" "a received mail without its delivery key"
refused_in inbound_0196 "$MAIL184, 'receiving', 'ABC', NULL, 'b', 'pending', NULL, NULL, NULL, NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', NULL)" "inbound_mails_delivery_key_shape" "a delivery key that is not a sha256"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'pending', NULL, 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_waiting_is_scanned" "a mail shown before its raw message was scanned"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'member_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_member_has_user" "a member's mail that names no member"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', '$U184_A1', '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_member_has_user" "an outsider's mail that names a member"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'member_unverified', 'system:inbound_mail', '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_none')" "inbound_mails_sender_user_is_person" "a member that is not a person's id"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{trusted}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_sender_flags_known" "an unknown sender flag"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', 'example.org; dkim=pass header.d=y.at; SPF=temperror', NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_authentication_results_shape" "a stored evidence line that carries spf= (RT-S18)"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_unverified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_maybe')" "inbound_mails_sender_reason_known" "an unknown sender reason"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_unverified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_reason_with_trust" "a DKIM pass labelled unverified"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_fail')" "inbound_mails_reason_with_trust" "a verified sender whose signature failed"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', NULL)" "inbound_mails_reason_with_trust" "a verdict that says no why"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'member_verified', '$U184_A1', '{bcc_own}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_bcc_own_paired" "a Bcc copy that is not also flagged as addressed elsewhere"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{not_addressed_to_project,bcc_own}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_bcc_own_paired" "an outsider's mail treated as a member's own Bcc copy"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'member_unverified', '$U184_A1', '{claims_member_name}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_none')" "inbound_mails_member_name_claim_external" "a member's own address flagged as claiming a member's name"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), NULL, 'external_verified', NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', 'dkim_pass')" "inbound_mails_sender_while_open" "a waiting mail that says nobody wrote it"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', NULL, NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', NULL)" "inbound_mails_trust_when_shown" "a waiting mail nobody checked"
refused_in inbound_0196 "$MAIL184, 'dropped', repeat('4', 64), 1, 'b', 'clean', now(), NULL, NULL, NULL, '{}', NULL, NULL, NULL, now() + interval '1 day', NULL)" "inbound_mails_dropped_with_reason" "a dropped mail without its reason"
refused_in inbound_0196 "$MAIL184, 'settled', repeat('4', 64), 1, 'b', 'clean', now(), NULL, 'external_verified', NULL, '{}', NULL, NULL, 'Betreff', now() + interval '1 day', 'dkim_pass')" "inbound_mails_ended_is_scrubbed" "a settled mail that keeps its subject"
refused_in inbound_0196 "$MAIL184, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), 'x@y.at', 'external_verified', NULL, '{}', NULL, NULL, NULL, now() - interval '1 day', 'dkim_pass')" "inbound_mails_expires_after_received" "a mail that expired before it arrived"
refused_in inbound_0196 "INSERT INTO inbound_mails (organization_id, project_id, address_id, staging_bucket, expires_at) VALUES ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'ab000000-0000-4000-8000-000000000184', 'b', now() + interval '1 day')" "inbound_mails_address_fkey" "a mail on another organization's address"
refused_in inbound_0196 "UPDATE inbound_mails SET raw_storage_key = 'org/org_0184_b/project/b0000000-0000-4000-8000-000000000184/_inbound-mail/1a000000-0000-4000-8000-000000000184/raw.eml' WHERE id = '1a000000-0000-4000-8000-000000000184'" "inbound_mails_staging_keys_shape" "a staged key outside the row's own project"
refused_in inbound_0196 "UPDATE inbound_mails SET raw_storage_key = 'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/doc/x/raw.eml' WHERE id = '1a000000-0000-4000-8000-000000000184'" "inbound_mails_staging_keys_shape" "a staged key outside the reserved prefix"
refused_in inbound_0196 "UPDATE inbound_mails SET signed_headers = '{From}' WHERE id = '1a000000-0000-4000-8000-000000000184'" "inbound_mails_signed_headers_shape" "a signed header that is not lowercase"
refused_in inbound_0196 "UPDATE inbound_mails SET status = 'settled', settled_at = now(), sender_address = NULL, subject = NULL WHERE id = '1a000000-0000-4000-8000-000000000184'" "inbound_mails_ended_is_scrubbed" "a settled mail whose staged objects are still named"
sql_in inbound_0196 <<<"UPDATE inbound_mails SET status = 'settled', settled_at = now(), sender_address = NULL, subject = NULL, raw_storage_key = NULL, read_storage_key = NULL, erasure_deferred_at = NULL WHERE id = '1c000000-0000-4000-8000-000000000184';"
sql_in inbound_0196 <<<"UPDATE inbound_mails SET status = 'waiting', settled_at = NULL, sender_address = 'x@h.at', subject = 'Held' WHERE id = '1c000000-0000-4000-8000-000000000184';"

# Parts: their one key, scanned before filed, the flags they may carry.
refused_in inbound_0196 "$PART184, 3, 'attachment', 'a.pdf', 'application/pdf', 1, repeat('e', 64), $KEY184/4', 'pending', NULL, '{}', '{}')" "inbound_mail_parts_storage_key_shape" "an attachment staged under another position's key"
refused_in inbound_0196 "$PART184, 3, 'message', 'a.txt', 'text/plain', 1, repeat('e', 64), NULL, 'not_applicable', NULL, '{}', '{}')" "inbound_mail_parts_message_has_no_object" "a message part with a file name"
sql_in inbound_0196 <<<"$PART184, 5, 'attachment', NULL, 'application/octet-stream', 1, repeat('e', 64), $KEY184/5', 'pending', NULL, '{}', '{}');"
check_in inbound_0196 "SELECT count(*) FROM inbound_mail_parts WHERE filename IS NULL AND kind = 'attachment'" "1" "0196: a file that came without a name is staged, for the person to name"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'dismissed', ended_at = now(), storage_key = NULL WHERE id = '2d000000-0000-4000-8000-000000000184'" "inbound_mail_parts_name_with_bytes" "a file name kept after its bytes were erased"
refused_in inbound_0196 "$PART184, 3, 'attachment', NULL, 'application/pdf', 1, repeat('e', 64), NULL, 'pending', NULL, '{}', '{}')" "inbound_mail_parts_bytes_while_open" "a waiting attachment without bytes"
refused_in inbound_0196 "$PART184, 3, 'message', NULL, 'text/plain', 1, repeat('e', 64), NULL, 'clean', now(), '{}', '{}')" "inbound_mail_parts_scan_applies" "the text scanned on its own"
refused_in inbound_0196 "$PART184, 3, 'attachment', 'a.pdf', 'application/pdf', 1, repeat('e', 64), $KEY184/3', 'not_applicable', NULL, '{}', '{}')" "inbound_mail_parts_scan_applies" "an attachment exempt from the scan"
refused_in inbound_0196 "$PART184, 3, 'attachment', 'a.pdf', 'application/pdf', 1, repeat('e', 64), $KEY184/3', 'pending', NULL, '{harmless}', '{}')" "inbound_mail_parts_risk_flags_known" "an unknown risk flag"
refused_in inbound_0196 "$PART184, 3, 'attachment', 'a.pdf', 'application/pdf', 1, repeat('e', 64), $KEY184/3', 'pending', NULL, '{}', '{Gehalt}')" "inbound_mail_parts_name_stop_terms" "name-stop terms without the flag"
refused_in inbound_0196 "$PART184, 1, 'attachment', 'a.pdf', 'application/pdf', 1, repeat('e', 64), $KEY184/1', 'pending', NULL, '{}', '{}')" "inbound_mail_parts_mail_position_key" "two parts at one position"
refused_in inbound_0196 "INSERT INTO inbound_mail_parts (organization_id, project_id, mail_id, position, kind, content_type, size_bytes, sha256, scan_status) VALUES ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', '1b000000-0000-4000-8000-000000000184', 9, 'message', 'text/plain', 1, repeat('e', 64), 'not_applicable')" "inbound_mail_parts_mail_fkey" "a part of another organization's mail"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET mail_thread_entry_id = 'e1000000-0000-4000-8000-000000000184' WHERE id = '2a000000-0000-4000-8000-000000000184'" "inbound_mail_parts_entry_only_for_filed_message" "a waiting text that names an entry"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET last_failure = 'gremlins' WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_failure_known" "an unknown filing failure"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'dismissed' WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_ended_at" "a dismissed part that does not say when"

# Nothing is filed without a person's file decision about THAT part (RT-S7).
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'filing', claim_expires_at = now() + interval '5 minutes' WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_decision_iff_filing" "a part claimed for filing with no decision"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', 'system:inbound_mail', 'app', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_decider_is_person" "a system actor deciding"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', 'user_1', 'app', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_decider_is_person" "a decider that is not a WorkOS user id"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'accept', '$U184_A1', 'app', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_action_known" "an unknown action"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'rule', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_via_known" "a decision that came by a rule"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'agent_proposal', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_proposal_iff_card" "an agent's card that names no proposal"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'agent_proposal', gen_random_uuid(), NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, true)" "inbound_mail_decisions_agent_cards_file_clean" "an agent's card that acknowledges a risk (RT-S5)"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'agent_proposal', gen_random_uuid(), NULL, 'Statik', NULL, NULL, NULL, NULL, true, false, false)" "inbound_mail_decisions_agent_cards_file_clean" "an agent's card that releases a stopped name (RT-S5)"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_destination_when_filing" "a filing with nowhere to go"
refused_in inbound_0196 "$DEC184, '2b000000-0000-4000-8000-000000000184', 'dismiss', '$U184_A1', 'app', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_destination_when_filing" "a dismissal with a destination"
refused_in inbound_0196 "${V184}$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', NULL, NULL, 'Statik', 'create', NULL, 'full', 'Statik', false, false, false)" "inbound_mail_decisions_thread_for_text" "an attachment filed into a thread"
refused_in inbound_0196 "${V184}$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', NULL, NULL, 'Statik', NULL, NULL, NULL, NULL, false, false, false)" "inbound_mail_decisions_thread_for_text" "a mail text filed outside a thread"
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', NULL, NULL, NULL, 'append', NULL, 'full', NULL, false, false, false)" "inbound_mail_decisions_thread_named" "an append that names no thread"
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', NULL, NULL, NULL, 'append', 'ea000000-0000-4000-8000-000000000184', NULL, NULL, false, false, false)" "inbound_mail_decisions_message_text" "a filed text that says neither masked nor full"
# A follow decision: the follower's own, a text appended, nothing acknowledged (D31).
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A2', 'follow', NULL, 'fa000000-0000-4000-8000-000000000184', NULL, 'append', 'ea000000-0000-4000-8000-000000000184', 'full', NULL, false, false, false)" "inbound_mail_decisions_follower_fkey" "a follow decision by someone other than the follower"
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'follow', NULL, 'fb000000-0000-4000-8000-000000000184', NULL, 'append', 'eb000000-0000-4000-8000-000000000184', 'full', NULL, false, false, false)" "inbound_mail_decisions_follower_fkey" "a follow decision on another organization's follow"
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'follow', NULL, 'fa000000-0000-4000-8000-000000000184', NULL, 'append', 'ea000000-0000-4000-8000-000000000184', 'full', NULL, false, true, false)" "inbound_mail_decisions_follow_appends_text_only" "a follow that acknowledges a sender"
refused_in inbound_0196 "$DEC184, '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'follow', NULL, 'fa000000-0000-4000-8000-000000000184', 'Statik', 'create', NULL, 'full', 'Neu', false, false, false)" "inbound_mail_decisions_follow_appends_text_only" "a follow that starts a new thread"
refused_in inbound_0196 "${V184}$DEC184, '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'follow', NULL, 'fa000000-0000-4000-8000-000000000184', NULL, 'append', 'ea000000-0000-4000-8000-000000000184', 'full', NULL, false, false, false)" "inbound_mail_decisions_follow_files_text" "a follow that files an attachment"
refused_in inbound_0196 "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by) VALUES ('org_0184_a', 'a0000000-0000-4000-8000-000000000184', '1b000000-0000-4000-8000-000000000184', '2c000000-0000-4000-8000-000000000184', 'dismiss', '$U184_A1')" "inbound_mail_decisions_part_fkey" "a decision about another organization's part"

# The decisions a person makes, and the parts they move.
sql_in inbound_0196 <<SQL
INSERT INTO inbound_mail_decisions (id, organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path) VALUES
  ('3a000000-0000-4000-8000-000000000184', $PA184, '1a000000-0000-4000-8000-000000000184', '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'app', 'Statik'),
  ('3b000000-0000-4000-8000-000000000184', $PA184, '1a000000-0000-4000-8000-000000000184', '2b000000-0000-4000-8000-000000000184', 'file', '$U184_A2', 'agent', 'Statik/Plaene');
INSERT INTO inbound_mail_decisions (id, organization_id, project_id, mail_id, part_id, action, decided_by) VALUES
  ('3c000000-0000-4000-8000-000000000184', $PA184, '1a000000-0000-4000-8000-000000000184', '2d000000-0000-4000-8000-000000000184', 'dismiss', '$U184_A1');
INSERT INTO inbound_mail_decisions (id, organization_id, project_id, mail_id, part_id, action, decided_by, via, proposal_id, folder_path) VALUES
  ('3e000000-0000-4000-8000-000000000184', $PA184, '1a000000-0000-4000-8000-000000000184', '2d000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'agent_proposal', gen_random_uuid(), 'Rechnungen');
INSERT INTO inbound_mail_decisions (id, organization_id, project_id, mail_id, part_id, action, decided_by, via, follow_id, thread_action, mail_thread_id, message_text) VALUES
  ('3d000000-0000-4000-8000-000000000184', $PA184, '1a000000-0000-4000-8000-000000000184', '2a000000-0000-4000-8000-000000000184', 'file', '$U184_A1', 'follow', 'fa000000-0000-4000-8000-000000000184', 'append', 'ea000000-0000-4000-8000-000000000184', 'full');
SQL
refused_in inbound_0196 "${V184}UPDATE inbound_mail_parts SET state = 'filing', decision_id = '3c000000-0000-4000-8000-000000000184', claim_expires_at = now() + interval '5 minutes' WHERE id = '2d000000-0000-4000-8000-000000000184'" "inbound_mail_parts_decision_files" "a part filed on a dismiss decision"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'filing', decision_id = '3e000000-0000-4000-8000-000000000184', claim_expires_at = now() + interval '5 minutes' WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_decision_fkey" "a part filed on another part's decision"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'filing', decision_id = '3e000000-0000-4000-8000-000000000184', claim_expires_at = now() + interval '5 minutes' WHERE id = '2d000000-0000-4000-8000-000000000184'" "inbound_mail_parts_filed_is_clean" "a part filed before its scan said clean"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'filing', decision_id = '3a000000-0000-4000-8000-000000000184' WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_claim_while_filing" "a filing part with no claim"
# Two deciders: both decisions are kept, one compare-and-swap claims the part.
CAS184="UPDATE inbound_mail_parts SET state = 'filing', claim_expires_at = now() + interval '5 minutes', decision_id = '%s' WHERE id = '2b000000-0000-4000-8000-000000000184' AND state = 'waiting' RETURNING 1"
check_in inbound_0196 "WITH c AS ($(printf "$CAS184" 3a000000-0000-4000-8000-000000000184)) SELECT count(*) FROM c" "1" "0196: the first decider claims the part"
check_in inbound_0196 "WITH c AS ($(printf "$CAS184" 3b000000-0000-4000-8000-000000000184)) SELECT count(*) FROM c" "0" "0196: the second decider's claim finds the part taken"
check_in inbound_0196 "SELECT decided_by FROM inbound_mail_decisions d JOIN inbound_mail_parts p ON p.decision_id = d.id WHERE p.id = '2b000000-0000-4000-8000-000000000184'" "$U184_A1" "0196: the part names the decider who claimed it"
refused_in inbound_0196 "UPDATE inbound_mail_parts SET state = 'filed', claim_expires_at = NULL, filed_at = now() WHERE id = '2b000000-0000-4000-8000-000000000184'" "inbound_mail_parts_no_bytes_when_filed" "a filed part still holding its staged bytes"
sql_in inbound_0196 <<'SQL'
UPDATE inbound_mail_parts SET state = 'filed', claim_expires_at = NULL, filed_at = now(), storage_key = NULL, filename = NULL,
       document_id = 'd1000000-0000-4000-8000-000000000184'
 WHERE id = '2b000000-0000-4000-8000-000000000184';
UPDATE inbound_mail_parts SET state = 'filed', decision_id = '3d000000-0000-4000-8000-000000000184', filed_at = now(),
       mail_thread_entry_id = 'e1000000-0000-4000-8000-000000000184'
 WHERE id = '2a000000-0000-4000-8000-000000000184';
UPDATE inbound_mail_parts SET state = 'dismissed', ended_at = now() WHERE id = '2d000000-0000-4000-8000-000000000184';
SQL
check_in inbound_0196 "SELECT string_agg(state, ',' ORDER BY position) FROM inbound_mail_parts WHERE mail_id = '1a000000-0000-4000-8000-000000000184'" "filed,filed,dismissed,waiting" "0196: the text appended by the follower, the attachment filed, the macro file dismissed, the nameless file still waiting"
# A decision is append-only: it is marked audited once, and nothing else changes.
refused_in inbound_0196 "${V184}UPDATE inbound_mail_decisions SET folder_path = 'Anderswo' WHERE id = '3a000000-0000-4000-8000-000000000184'" "inbound_mail_decisions_immutable" "a decision rewritten"
sql_in inbound_0196 <<<"UPDATE inbound_mail_decisions SET audited_at = now() WHERE id = '3a000000-0000-4000-8000-000000000184';"
refused_in inbound_0196 "${V184}UPDATE inbound_mail_decisions SET audited_at = now() + interval '1 hour' WHERE id = '3a000000-0000-4000-8000-000000000184'" "inbound_mail_decisions_immutable" "a decision audited twice"
refused_in inbound_0196 "${V184}DELETE FROM inbound_mail_decisions WHERE id = '3b000000-0000-4000-8000-000000000184'" "inbound_mail_decisions_audited_before_delete" "a decision deleted before the audit trail took it, even by the owner (RT-S8)"

# A decision's Dokumentart is the shared vocabulary's, whose persisted keys are
# still German today (D6 renames them later): the code checks membership, the
# database bounds the value to one printable line.
sql_in inbound_0196 <<<"$DEC184, '2d000000-0000-4000-8000-000000000184', 'dismiss', '$U184_A2', 'app', NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false, false);"
sql_in inbound_0196 <<<"INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, folder_path, document_type, audited_at) VALUES ($PA184, '1a000000-0000-4000-8000-000000000184', '2d000000-0000-4000-8000-000000000184', 'file', '$U184_A2', 'Normen', 'Norm/Richtlinie', now());"
refused_in inbound_0196 "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, folder_path, document_type) VALUES ($PA184, '1a000000-0000-4000-8000-000000000184', '2d000000-0000-4000-8000-000000000184', 'file', '$U184_A2', 'X', E'Bescheid\\nNorm')" "inbound_mail_decisions_lengths" "a Dokumentart that is not one printable line"
refused_in inbound_0196 "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, folder_path, document_type) VALUES ($PA184, '1a000000-0000-4000-8000-000000000184', '2d000000-0000-4000-8000-000000000184', 'file', '$U184_A2', 'X', repeat('x', 65))" "inbound_mail_decisions_lengths" "a Dokumentart past its bound"

# What came with a filed message (D36): one row per attachment, its document
# and Fassung the live half of the link, what the section prints frozen.
sql_in inbound_0196 <<'SQL'
INSERT INTO document_versions (id, organization_id, document_id, project_id, version_number, state, storage_key, created_by) VALUES
  ('f1000000-0000-4000-8000-000000000184', 'org_0184_a', 'd1000000-0000-4000-8000-000000000184', 'a0000000-0000-4000-8000-000000000184', 1, 'superseded', 'k/0196/a', 'user_01J0MA1LUSERA00000000000A1');
INSERT INTO mail_thread_entry_attachments (id, organization_id, project_id, entry_id, position, filename, disposition, not_filed_reason, document_id, document_version_id, section_name, section_folder_path) VALUES
  ('fa100000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'e1000000-0000-4000-8000-000000000184', 1, 'S-101.pdf', 'filed', NULL, 'd1000000-0000-4000-8000-000000000184', 'f1000000-0000-4000-8000-000000000184', 'S-101.pdf', 'Statik'),
  ('fa200000-0000-4000-8000-000000000184', 'org_0184_a', 'a0000000-0000-4000-8000-000000000184', 'e1000000-0000-4000-8000-000000000184', 2, 'Rechnung.docm', 'not_filed', 'pending', NULL, NULL, NULL, NULL),
  ('fa300000-0000-4000-8000-000000000184', 'org_0184_a', 'c0000000-0000-4000-8000-000000000184', 'e3000000-0000-4000-8000-000000000184', 1, 'Gehalten.pdf', 'not_filed', 'dismissed', NULL, NULL, NULL, NULL),
  ('fa400000-0000-4000-8000-000000000184', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'e4000000-0000-4000-8000-000000000184', 1, NULL, 'not_filed', 'size', NULL, NULL, NULL, NULL);
-- The filed part names the Fassung it became, as the filing job records it.
UPDATE inbound_mail_parts SET document_version_id = 'f1000000-0000-4000-8000-000000000184'
 WHERE id = '2b000000-0000-4000-8000-000000000184';
SQL
# An entry's first Fassung is a Fassung of its own project's (review D,
# finding 9): the key carries the project, so another tenant's version id is
# refused even by a writer that names it.
sql_in inbound_0196 <<<"INSERT INTO document_versions (id, organization_id, document_id, project_id, version_number, state, storage_key, created_by) VALUES ('f3000000-0000-4000-8000-000000000184', 'org_0184_b', 'd3000000-0000-4000-8000-000000000184', 'b0000000-0000-4000-8000-000000000184', 1, 'superseded', 'k/0196/b', 'user_01J0MA1LUSERB00000000000B1');"
refused_in inbound_0196 "${V184}UPDATE mail_thread_entries SET first_version_id = 'f3000000-0000-4000-8000-000000000184' WHERE id = 'e1000000-0000-4000-8000-000000000184'" "mail_thread_entries_first_version_fkey" "an entry whose first Fassung is another tenant's"
sql_in inbound_0196 <<<"UPDATE mail_thread_entries SET first_version_id = 'f1000000-0000-4000-8000-000000000184' WHERE id = 'e1000000-0000-4000-8000-000000000184';"
ATT184="INSERT INTO mail_thread_entry_attachments (organization_id, project_id, entry_id, position, disposition, not_filed_reason, document_id, document_version_id, section_name, section_folder_path) VALUES ($PA184, 'e1000000-0000-4000-8000-000000000184'"
refused_in inbound_0196 "$ATT184, 1, 'not_filed', 'dismissed', NULL, NULL, NULL, NULL)" "mail_thread_entry_attachments_entry_position_key" "two rows for one attachment"
refused_in inbound_0196 "$ATT184, 3, 'kept', NULL, NULL, NULL, NULL, NULL)" "mail_thread_entry_attachments_disposition_known" "an unknown disposition"
refused_in inbound_0196 "$ATT184, 3, 'filed', 'dismissed', 'd1000000-0000-4000-8000-000000000184', NULL, NULL, NULL)" "mail_thread_entry_attachments_reason_iff_not_filed" "a filed attachment with a reason it was not filed"
refused_in inbound_0196 "$ATT184, 3, 'not_filed', NULL, NULL, NULL, NULL, NULL)" "mail_thread_entry_attachments_reason_iff_not_filed" "an attachment not filed for no reason"
refused_in inbound_0196 "$ATT184, 3, 'not_filed', 'forgotten', NULL, NULL, NULL, NULL)" "mail_thread_entry_attachments_reason_known" "an unknown reason"
refused_in inbound_0196 "$ATT184, 3, 'not_filed', 'dismissed', 'd1000000-0000-4000-8000-000000000184', NULL, NULL, NULL)" "mail_thread_entry_attachments_not_filed_has_no_document" "an attachment not filed that names a document"
refused_in inbound_0196 "$ATT184, 3, 'not_filed', 'dismissed', NULL, NULL, 'Gehaltsliste.xlsx', NULL)" "mail_thread_entry_attachments_section_named_when_filed" "a section that names an attachment nobody filed (RT-S13)"
refused_in inbound_0196 "$ATT184, 3, 'filed', NULL, 'd1000000-0000-4000-8000-000000000184', NULL, NULL, 'Intern')" "mail_thread_entry_attachments_section_folder_with_name" "a section that names a folder and no file"
refused_in inbound_0196 "$ATT184, 3, 'filed', NULL, 'd3000000-0000-4000-8000-000000000184', NULL, NULL, NULL)" "mail_thread_entry_attachments_document_fkey" "an attachment filed as another project's document"
refused_in inbound_0196 "INSERT INTO mail_thread_entry_attachments (organization_id, project_id, entry_id, position, disposition, not_filed_reason) VALUES ('org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'e1000000-0000-4000-8000-000000000184', 5, 'not_filed', 'size')" "mail_thread_entry_attachments_entry_fkey" "an attachment row on another organization's entry"
refused_in inbound_0196 "${V184}UPDATE mail_thread_entry_attachments SET section_name = 'Gehaltsliste.xlsx' WHERE id = 'fa100000-0000-4000-8000-000000000184'" "mail_thread_entry_attachments_frozen" "a section's frozen words rewritten (the superset invariant)"
refused_in inbound_0196 "${V184}UPDATE mail_thread_entry_attachments SET disposition = 'not_filed', not_filed_reason = 'dismissed', document_id = NULL, document_version_id = NULL WHERE id = 'fa100000-0000-4000-8000-000000000184'" "mail_thread_entry_attachments_decided_once" "a filed attachment turned into one never filed"
sql_in inbound_0196 <<<"UPDATE mail_thread_entry_attachments SET disposition = 'filed', not_filed_reason = NULL, document_id = 'd1000000-0000-4000-8000-000000000184' WHERE id = 'fa200000-0000-4000-8000-000000000184';"
check_in inbound_0196 "SELECT disposition || ':' || coalesce(section_name, 'unnamed') FROM mail_thread_entry_attachments WHERE id = 'fa200000-0000-4000-8000-000000000184'" "filed:unnamed" "0196: an attachment that waited is filed later, and the section's words stay frozen"
refused_in inbound_0196 "${V184}UPDATE mail_thread_entry_attachments SET document_id = 'd1000000-0000-4000-8000-000000000184', disposition = 'already_present' WHERE id = 'fa200000-0000-4000-8000-000000000184'" "mail_thread_entry_attachments_decided_once" "an attachment decided twice"
refused_in inbound_0196 "UPDATE mail_threads SET render_lease_holder = gen_random_uuid() WHERE id = 'ea000000-0000-4000-8000-000000000184'" "mail_threads_render_lease_together" "a render lease without its end"

# Threads, entries, message ids and follows.
refused_in inbound_0196 "$THREAD184, NULL, 'x', 'fr', '$U184_A1')" "mail_threads_locale_known" "a thread in a locale nobody renders"
refused_in inbound_0196 "$THREAD184, NULL, 'x', 'de', 'system:archive')" "mail_threads_creator_is_person" "a thread nobody created"
refused_in inbound_0196 "$THREAD184, 'd3000000-0000-4000-8000-000000000184', 'x', 'de', '$U184_A1')" "mail_threads_document_fkey" "a thread whose document is another project's"
refused_in inbound_0196 "$THREAD184, 'd1000000-0000-4000-8000-000000000184', 'x', 'de', '$U184_A1')" "uniq_mail_threads_document" "a second thread on one document"
refused_in inbound_0196 "UPDATE mail_threads SET entry_count = 201 WHERE id = 'ea000000-0000-4000-8000-000000000184'" "mail_threads_entry_count_bounded" "a thread past its entry cap"
refused_in inbound_0196 "$ENTRY184, 'archive', NULL, gen_random_uuid(), now(), now(), 'h1', 'not_checked', '$U184_A1', 'archive_import', NULL, 'b', 'k', repeat('a', 64), 1, 'clean')" "mail_thread_entries_archive_has_no_original" "an archive entry with an original"
refused_in inbound_0196 "$ENTRY184, 'archive', NULL, gen_random_uuid(), now(), now(), 'h1', 'external_verified', '$U184_A1', 'archive_import', NULL, NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_archive_not_checked" "an archive entry that claims a checked sender"
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'external_verified', '$U184_A1', 'archive_import', NULL, NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_archive_imported" "an inbound entry filed by an import"
refused_in inbound_0196 "$ENTRY184, 'inbound', NULL, NULL, now(), now(), 'h1', 'external_verified', '$U184_A1', 'app', NULL, NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_provenance" "an inbound entry that names no mail"
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'external_verified', 'system:follow', 'follow', NULL, NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_filer_is_person" "an entry nobody filed"
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'external_verified', '$U184_A1', 'app', 'example.org; spf=pass', NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_authentication_results_shape" "an entry's evidence line with spf="
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'external_verified', '$U184_A1', 'app', NULL, 'b', NULL, repeat('a', 64), 1, 'clean')" "mail_thread_entries_original_together" "half an original"
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'external_verified', '$U184_A1', 'app', NULL, 'b', 'org/org_0184_a/project/a0000000-0000-4000-8000-000000000184/_mail-originals/e1000000-0000-4000-8000-000000000184.eml', repeat('a', 64), 1, 'clean')" "mail_thread_entries_original_key_shape" "an original under another entry's key"
refused_in inbound_0196 "$ENTRY184, 'inbound', gen_random_uuid(), NULL, now(), now(), '21.10.2026 09:00 · Huber (statik.at)', 'external_verified', '$U184_A1', 'app', NULL, NULL, NULL, NULL, NULL, NULL)" "mail_thread_entries_heading_key" "two sections with one heading"
refused_in inbound_0196 "INSERT INTO mail_thread_message_ids (organization_id, project_id, thread_id, message_id, state) VALUES ($PA184, 'ea000000-0000-4000-8000-000000000184', 'm9@x.at', 'received')" "mail_thread_message_ids_received_by_entry" "a received id with no entry"
refused_in inbound_0196 "INSERT INTO mail_thread_message_ids (organization_id, project_id, thread_id, message_id, state, entry_id) VALUES ($PA184, 'eb000000-0000-4000-8000-000000000184', 'm1@statik.at', 'received', 'e1000000-0000-4000-8000-000000000184')" "mail_thread_message_ids_thread_fkey" "an id in another organization's thread"
refused_in inbound_0196 "INSERT INTO mail_thread_message_ids (organization_id, project_id, thread_id, message_id, state, entry_id) VALUES ($PA184, 'ea000000-0000-4000-8000-000000000184', 'm1@statik.at', 'received', 'e1000000-0000-4000-8000-000000000184')" "mail_thread_message_ids_key" "the same id received twice by one entry"
refused_in inbound_0196 "$FOLLOW184, 'system:follow', now(), now() + interval '1 day', NULL, NULL, NULL)" "mail_thread_follows_follower_is_person" "a follow nobody made"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '181 days', NULL, NULL, NULL)" "mail_thread_follows_window" "a follow past 180 days"
refused_in inbound_0196 "$FOLLOW184, '$U184_A1', now(), now() + interval '60 days', NULL, NULL, NULL)" "uniq_mail_thread_follows_active" "a second active follow by one person"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '60 days', now(), NULL, NULL)" "mail_thread_follows_ended_with_reason" "a follow ended for no reason"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '60 days', now(), NULL, 'unfollowed')" "mail_thread_follows_person_reason_attributed" "an unfollow nobody made"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '60 days', now(), '$U184_A1', 'unfollowed')" "mail_thread_follows_person_reason_attributed" "an unfollow by someone else"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '60 days', now(), '$U184_A2', 'revoked_by_manager')" "mail_thread_follows_person_reason_attributed" "a manager revoking their own follow"
refused_in inbound_0196 "$FOLLOW184, '$U184_A2', now(), now() + interval '60 days', now(), NULL, 'bored')" "mail_thread_follows_ended_reason_known" "an unknown end reason"
# A detach moves an entry; its message ids move with it.
sql_in inbound_0196 <<<"UPDATE mail_thread_entries SET thread_id = 'ed000000-0000-4000-8000-000000000184' WHERE id = 'e2000000-0000-4000-8000-000000000184';"
check_in inbound_0196 "SELECT string_agg(state || '@' || thread_id::text, ',' ORDER BY state) FROM mail_thread_message_ids WHERE message_id = 'm0@buero.at'" \
  "received@ed000000-0000-4000-8000-000000000184,referenced@ea000000-0000-4000-8000-000000000184" "0196: a detached entry's received id moves with it; another entry's reference stays"
refused_in inbound_0196 "UPDATE mail_thread_message_ids SET thread_id = 'ec000000-0000-4000-8000-000000000184', project_id = 'c0000000-0000-4000-8000-000000000184' WHERE entry_id = 'e1000000-0000-4000-8000-000000000184'" "mail_thread_message_ids_entry_fkey" "an entry's id moved to a thread the entry is not in"

# The runtime role: its organization's rows only, in all nine tables, and no DELETE.
# The runtime role answers to its deployed name, so rename the roles as the deploy does.
rename_rls_roles
for table in inbound_mail_addresses inbound_mails inbound_mail_parts inbound_mail_decisions mail_threads mail_thread_entries mail_thread_entry_attachments mail_thread_message_ids mail_thread_follows; do
  seen=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d inbound_0196 -qtA \
    -c "SET grid.organization_id = 'org_0184_b'" \
    -c "SELECT coalesce(string_agg(DISTINCT organization_id, ','), '') FROM $table")
  if [ "$seen" != "org_0184_b" ]; then
    echo "MIGRATION ASSERTION FAILED on inbound_0196: the runtime role in org_0184_b saw $table rows of '$seen'" >&2
    exit 1
  fi
done
for table in inbound_mail_addresses inbound_mails inbound_mail_parts inbound_mail_decisions mail_threads mail_thread_entries mail_thread_entry_attachments mail_thread_follows; do
  if out=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d inbound_0196 -qtA -v ON_ERROR_STOP=1 \
      -c "SET grid.organization_id = 'org_0184_b'" -c "DELETE FROM $table WHERE organization_id = 'org_0184_b'" 2>&1); then
    echo "MIGRATION ASSERTION FAILED on inbound_0196: the runtime role deleted from $table" >&2
    exit 1
  fi
  if ! grep -q "permission denied" <<<"$out"; then
    echo "MIGRATION ASSERTION FAILED on inbound_0196: a runtime DELETE on $table was refused for another reason: $out" >&2
    exit 1
  fi
done
RWINS184=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d inbound_0196 -qtA \
  -c "SET grid.organization_id = 'org_0184_a'" \
  -c "INSERT INTO mail_thread_follows (organization_id, project_id, thread_id, user_id, expires_at) VALUES ('org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'eb000000-0000-4000-8000-000000000184', '$U184_A1', now() + interval '1 day')" 2>&1 || true)
if ! grep -q "row-level security" <<<"$RWINS184"; then
  echo "MIGRATION ASSERTION FAILED on inbound_0196: the runtime role in org_0184_a wrote a follow into org_0184_b ($RWINS184)" >&2
  exit 1
fi
restore_rls_role_names

# Legal hold: a held project's mail and filed messages are not deleted.
sql_in inbound_0196 <<<"INSERT INTO legal_holds (entity_type, entity_id, organization_id, reason, created_by) VALUES ('project', 'c0000000-0000-4000-8000-000000000184', 'org_0184_a', 'rls test', 'user_1');"
refused_in inbound_0196 "DELETE FROM inbound_mails WHERE id = '1c000000-0000-4000-8000-000000000184'" "legal hold" "a held project's mail deleted"
refused_in inbound_0196 "DELETE FROM mail_thread_entries WHERE id = 'e3000000-0000-4000-8000-000000000184'" "legal hold" "a held project's filed message deleted"
refused_in inbound_0196 "DELETE FROM mail_thread_entry_attachments WHERE id = 'fa300000-0000-4000-8000-000000000184'" "legal hold" "what came with a held project's filed message deleted"
refused_in inbound_0196 "DELETE FROM mail_threads WHERE id = 'ec000000-0000-4000-8000-000000000184'" "legal hold" "a held project's thread deleted with its entries"
sql_in inbound_0196 <<<"UPDATE legal_holds SET released_at = now() WHERE entity_id = 'c0000000-0000-4000-8000-000000000184';"

# The document goes: the thread and the filed part lose it, the entries stay
# until the sweep deletes the thread.
sql_in inbound_0196 <<<"DELETE FROM documents WHERE id = 'd1000000-0000-4000-8000-000000000184';"
# The part's Fassung goes too: once its document key has set `document_id`
# NULL, the composite key to the Fassung is no longer checked and its own SET
# NULL never fires, so the parts' guard clears the Fassung itself.
check_in inbound_0196 "SELECT (SELECT coalesce(document_id::text, 'gone') FROM mail_threads WHERE id = 'ea000000-0000-4000-8000-000000000184') || ',' || (SELECT state || ':' || coalesce(document_id::text, 'gone') || ':' || coalesce(document_version_id::text, 'gone') FROM inbound_mail_parts WHERE id = '2b000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM mail_thread_entries WHERE thread_id = 'ea000000-0000-4000-8000-000000000184')" \
  "gone,filed:gone:gone,1" "0196: deleting the document keeps the filed part, without its document or Fassung, and the entries until the sweep"
check_in inbound_0196 "SELECT string_agg(position || ':' || disposition || ':' || coalesce(document_id::text, 'gone') || ':' || coalesce(document_version_id::text, 'gone') || ':' || coalesce(section_name, '-'), ',' ORDER BY position) FROM mail_thread_entry_attachments WHERE entry_id = 'e1000000-0000-4000-8000-000000000184'" \
  "1:filed:gone:gone:S-101.pdf,2:filed:gone:gone:-" "0196: deleting the document keeps the record that it came, and the section's words (D36)"
# Sweep 9 deletes the thread: it waits for the follower's decision to be audited (RT-S8) ...
refused_in inbound_0196 "${V184}DELETE FROM mail_threads WHERE id = 'ea000000-0000-4000-8000-000000000184'" "inbound_mail_decisions_audited_before_delete" "a thread deleted while its follow's decision is owed to the trail"
sql_in inbound_0196 <<<"UPDATE inbound_mail_decisions SET audited_at = now() WHERE id = '3d000000-0000-4000-8000-000000000184';"
# ... and then takes its entries, ids and follows, the follow's decision and the text it filed.
sql_in inbound_0196 <<<"DELETE FROM mail_threads WHERE id = 'ea000000-0000-4000-8000-000000000184';"
check_in inbound_0196 "SELECT (SELECT count(*) FROM mail_thread_entries WHERE thread_id = 'ea000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM mail_thread_message_ids WHERE thread_id = 'ea000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM mail_thread_follows WHERE thread_id = 'ea000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM inbound_mail_decisions WHERE id = '3d000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM inbound_mail_parts WHERE id = '2a000000-0000-4000-8000-000000000184') || ',' || (SELECT count(*) FROM mail_thread_entry_attachments WHERE entry_id = 'e1000000-0000-4000-8000-000000000184')" \
  "0,0,0,0,0,0" "0196: deleting a thread takes its entries, what came with them, ids, follows, the follow's decision and the text part it filed"
# Sweep 8 deletes a mail only once its decisions are audited.
refused_in inbound_0196 "${V184}DELETE FROM inbound_mails WHERE id = '1a000000-0000-4000-8000-000000000184'" "inbound_mail_decisions_audited_before_delete" "a mail deleted while a decision about it is owed to the trail"
refused_in inbound_0196 "DELETE FROM inbound_mail_addresses WHERE id = 'aa000000-0000-4000-8000-000000000184'" "inbound_mails_address_fkey" "an address deleted from under its mail"

# The purge: deleting the project takes all nine tables, unaudited decisions included.
sql_in inbound_0196 <<<"DELETE FROM projects WHERE id = 'a0000000-0000-4000-8000-000000000184';"
check_in inbound_0196 "SELECT (SELECT count(*) FROM inbound_mail_addresses WHERE project_id = 'a0000000-0000-4000-8000-000000000184') + (SELECT count(*) FROM inbound_mails WHERE project_id = 'a0000000-0000-4000-8000-000000000184') + (SELECT count(*) FROM inbound_mail_parts WHERE project_id = 'a0000000-0000-4000-8000-000000000184') + (SELECT count(*) FROM inbound_mail_decisions WHERE project_id = 'a0000000-0000-4000-8000-000000000184') + (SELECT count(*) FROM mail_threads WHERE project_id = 'a0000000-0000-4000-8000-000000000184')" \
  "0" "0196: a project purge takes its addresses, mails, parts, decisions and threads"
check_in inbound_0196 "SELECT count(*) FROM inbound_mails WHERE organization_id = 'org_0184_b'" "1" "0196: and nothing of another project"

# D33: the archive import counts the Verläufe it opened and joined and the mails the project already held.
sql_in inbound_0196 <<<"INSERT INTO mail_imports (id, organization_id, project_id, user_id, filename, size_bytes, staging_bucket, staging_key) VALUES ('ab000000-0000-4000-8000-000000000186', 'org_0184_b', 'b0000000-0000-4000-8000-000000000184', 'user_01J0MA1LUSERB00000000000B1', 'Postfach.pst', 10, 'b', 'org/org_0184_b/project/b0000000-0000-4000-8000-000000000184/mail-imports/ab000000-0000-4000-8000-000000000186/archive');"
check_in inbound_0196 "SELECT threads_created || ',' || threads_appended || ',' || already_in_project FROM mail_imports WHERE id = 'ab000000-0000-4000-8000-000000000186'" \
  "0,0,0" "0196: an import has opened, joined and skipped no Verlauf before it files a mail"
refused_in inbound_0196 "UPDATE mail_imports SET already_in_project = -1 WHERE id = 'ab000000-0000-4000-8000-000000000186'" "mail_imports_thread_counts_non_negative" "a negative Verlauf count on an import"

# Down: refused while a row names an object, clean once none does; 0196 applies again.
apply_in inbound_0196 0196_inbound_mail.sql
check_in inbound_0196 "SELECT count(*) FROM inbound_mails" "2" "0196 re-applies and keeps the mail"
# The follow job counts a project's follow appends of the last day under a lock (D31 condition 8).
check_in inbound_0196 "SELECT count(*) FROM pg_indexes WHERE indexname = 'inbound_mail_decisions_project_follow_idx'" "1" "0196 builds the project follow-cap index"
sql_in inbound_0196 <<<"UPDATE inbound_mails SET raw_storage_key = 'org/org_0184_b/project/b0000000-0000-4000-8000-000000000184/_inbound-mail/1b000000-0000-4000-8000-000000000184/raw.eml' WHERE id = '1b000000-0000-4000-8000-000000000184';"
refused_in inbound_0196 "$(cat migrations/0196_inbound_mail.down.sql)" "reverse 0196 refused" "the down while a mail names its staged raw message"
check_in inbound_0196 "SELECT count(*) FROM pg_tables WHERE tablename LIKE 'inbound\_mail%' OR tablename LIKE 'mail\_thread%'" "9" "the refused down dropped nothing"
sql_in inbound_0196 <<'SQL'
INSERT INTO inbox_items (organization_id, recipient_user_id, type, resource_type, resource_id, group_key, actionable)
VALUES ('org_0184_b', 'u', 'inbound_mail.waiting', 'project', 'b0000000-0000-4000-8000-000000000184', 'inbound_mail.waiting:p', true),
       ('org_0184_b', 'u', 'document.new_revision', 'document', 'd3000000-0000-4000-8000-000000000184', 'document.new_revision:d', false);
UPDATE inbound_mails SET raw_storage_key = NULL;
SQL
apply_in inbound_0196 0196_inbound_mail.down.sql
check_in inbound_0196 "SELECT count(*) FROM pg_tables WHERE tablename LIKE 'inbound\_mail%' OR tablename LIKE 'mail\_thread%'" "0" "0196 down drops the nine tables"
check_in inbound_0196 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'mail_imports' AND column_name IN ('threads_created', 'threads_appended', 'already_in_project')" "0" "0196 down drops the import's Verlauf counts"
check_in inbound_0196 "SELECT string_agg(type, ',') FROM inbox_items WHERE organization_id = 'org_0184_b'" "document.new_revision" "0196 down removes the mail notices and nothing else"
check_in inbound_0196 "SELECT count(*) FROM pg_proc WHERE proname IN ('inbound_mail_decisions_guard', 'inbound_mail_parts_decision_guard', 'inbound_mail_parts_document_guard', 'refuse_held_project_row_delete', 'mail_thread_entry_attachments_guard')" "0" "0196 down drops its functions"
check_in inbound_0196 "SELECT count(*) FROM documents WHERE id = 'd3000000-0000-4000-8000-000000000184'" "1" "0196 down leaves the documents"
check_in inbound_0196 "SELECT count(*) FROM pg_indexes WHERE indexname = 'inbound_mail_decisions_project_follow_idx'" "0" "0196 down drops the project follow-cap index"
apply_in inbound_0196 0196_inbound_mail.sql
check_in inbound_0196 "SELECT count(*) FROM pg_tables WHERE tablename LIKE 'inbound\_mail%' OR tablename LIKE 'mail\_thread%'" "9" "0196 applies again after its down"
check_in inbound_0196 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'mail_imports' AND column_name IN ('threads_created', 'threads_appended', 'already_in_project')" "3" "0196 adds the import's Verlauf counts again after its down"
echo "==> 0196 inbound mail, threads and follows and their down migration verified"
# S9: on a large document_versions the operator builds the key's index online
# first; 0196 adopts a valid one (USING INDEX) instead of building it under the
# lock, on a clone taken just before 0196.
migrate_before prebuilt_0196 0196_inbound_mail
$PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d prebuilt_0196 -v ON_ERROR_STOP=1 -q \
  -c 'CREATE UNIQUE INDEX CONCURRENTLY "document_versions_id_project_id_key" ON "document_versions" ("id", "project_id")' >/dev/null
PREBUILT_OID=$($PGBIN/psql -h "$WORKDIR" -p "$PORT" -U "$OWNER" -d prebuilt_0196 -tAc "SELECT 'document_versions_id_project_id_key'::regclass::oid")
apply_in prebuilt_0196 0196_inbound_mail.sql
check_in prebuilt_0196 "SELECT conindid::text FROM pg_constraint WHERE conname = 'document_versions_id_project_id_key'" "$PREBUILT_OID" "0196 adopts the index an operator built online"
echo "==> 0196 adopts a pre-built document_versions key"

# ---------------------------------------------------------------------------
# Migration 0197: the sender rule (ADR-0137, amendment of 2026-11-03), and the
# DOWN.
#
# A mail whose From is a project writer and whose domain signed it is filed
# directly, as that writer (`via = 'sender'`); every other mail waits, a mail
# that only claims a writer for that writer alone. On a database of its own,
# migrated to just before 0197 and seeded with mail 0196 held, so the backfill
# runs over real rows. Every refusal 0197 promises is a violating statement
# here, named by its rule: the class needs its evidence, it is written by the
# hold and frozen after, a direct filing is the verified sender's own on a
# clean, unflagged part, a spoofed or replayed writer's mail is released only
# by that writer, an outsider's expired mail is never restored, the triggers
# bind the runtime and the platform role alike and never see another tenant.
# Then the down: refused while a direct filing exists, clean once none does.
# ---------------------------------------------------------------------------
echo "==> verifying the 0197 sender rule and its down migration on sender_0197"
migrate_before sender_0197 0197_sender_class
# W and X may write in the project, O is an office member who may not; the
# database knows none of that, only the class the receive job wrote.
W194="user_01J0MA1LUSERW00000000000W1"
X194="user_01J0MA1LUSERX00000000000X1"
O194="user_01J0MA1LUSERO00000000000O1"
P194="a0000000-0000-4000-8000-000000000194"
PB194="b0000000-0000-4000-8000-000000000194"
sql_in sender_0197 <<SQL
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('$P194', 'org_0197_a', 'Sender A', '$W194', 'proj_0197_a'),
  ('$PB194', 'org_0197_b', 'Sender B', '$W194', 'proj_0197_b');
INSERT INTO inbound_mail_addresses (id, organization_id, project_id, token, slug, created_by) VALUES
  ('aa000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', 'aaaaaaaaaaab', 'sender-a', '$W194'),
  ('ab000000-0000-4000-8000-000000000194', 'org_0197_b', '$PB194', 'bbbbbbbbbbbc', 'sender-b', '$W194');
-- Held by 0196: a member's unsigned mail and an outsider's signed one.
INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket,
                           raw_scan_status, raw_scanned_at, sender_address, sender_trust, sender_reason, sender_user_id, expires_at) VALUES
  ('10000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', 'aa000000-0000-4000-8000-000000000194', 'waiting', repeat('0', 64), 100, 'b',
   'clean', now(), 'w@buero.at', 'member_unverified', 'dkim_none', '$W194', now() + interval '30 days'),
  ('10b00000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', 'aa000000-0000-4000-8000-000000000194', 'waiting', repeat('1', 64), 100, 'b',
   'clean', now(), 'x@statik.at', 'external_verified', 'dkim_pass', NULL, now() + interval '30 days');
SQL
apply_in sender_0197 0197_sender_class.sql
check_in sender_0197 "SELECT string_agg(sender_trust || ':' || sender_class, ',' ORDER BY id) FROM inbound_mails" \
  "member_unverified:office_member,external_verified:external" "0197 classifies what 0196 held, checking nobody's write right"
check_in sender_0197 "SELECT count(*) FROM inbound_mails WHERE sender_class = 'verified_writer'" "0" "0197's backfill makes no mail a verified writer's"
AFTER_0197=$($PSQL -d sender_0197 -tAc "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conname LIKE 'inbound_mail%' OR conname LIKE 'mail_thread_entries%'")
apply_in sender_0197 0197_sender_class.sql
check_in sender_0197 "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conname LIKE 'inbound_mail%' OR conname LIKE 'mail_thread_entries%'" "$AFTER_0197" "0197 re-applied changes nothing"

V194=$'\\set VERBOSITY verbose\n'
# A mail as the webhook leaves it (`received`, its raw message staged and
# scanned), so the hold is the UPDATE that judges it, as `holdMail` does.
received194() {  # <mail id> [org] [project] [address]
  local org="${2:-org_0197_a}" project="${3:-$P194}" address="${4:-aa000000-0000-4000-8000-000000000194}"
  sql_in sender_0197 <<<"INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_storage_key, raw_scan_status, raw_scanned_at, expires_at) VALUES ('$1', '$org', '$project', '$address', 'received', md5('$1') || md5('$1'), 100, 'b', 'org/$org/project/$project/_inbound-mail/$1/raw.eml', 'clean', now(), now() + interval '30 days');"
}
# The hold of <mail>, with the verdict's columns as `<trust>, <reason>, <user>, <flags>, <automatic>, <class>`.
HOLD194="UPDATE inbound_mails SET status = 'waiting', sender_address = 'w@buero.at', (sender_trust, sender_reason, sender_user_id, sender_flags, automatic, sender_class) = "
held194() { sql_in sender_0197 <<<"$HOLD194($2) WHERE id = '$1';"; }
# A mail inserted held, as only an older build or a script would (never a verified writer's).
waiting194() {  # <mail id> <trust> <reason> <user or NULL> <class>
  sql_in sender_0197 <<<"INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, sender_address, sender_trust, sender_reason, sender_user_id, sender_class, expires_at) VALUES ('$1', 'org_0197_a', '$P194', 'aa000000-0000-4000-8000-000000000194', 'waiting', md5('$1') || md5('$1'), 100, 'b', 'clean', now(), 'w@buero.at', '$2', '$3', $4, '$5', now() + interval '30 days');"
}
M1="11000000-0000-4000-8000-000000000194"   # verified_writer W
M2="12000000-0000-4000-8000-000000000194"   # unverified_writer W, the signature failed
M3="13000000-0000-4000-8000-000000000194"   # unverified_writer W, a spoofed From: no signature at all
M4="14000000-0000-4000-8000-000000000194"   # office_member O
M5="15000000-0000-4000-8000-000000000194"   # external, unsigned
M6="16000000-0000-4000-8000-000000000194"   # external, signed
M7="17000000-0000-4000-8000-000000000194"   # verified_writer W, its raw message did not scan clean
M8="18000000-0000-4000-8000-000000000194"   # unverified_writer W, the member's own Bcc copy (or a recipient's replay of it)
M9="1a000000-0000-4000-8000-000000000194"   # verified_writer W, filed by the runtime role
MR="19000000-0000-4000-8000-000000000194"   # received, for the holds that must be refused
MB="1b000000-0000-4000-8000-000000000194"   # verified_writer W, in org B
received194 "$M1"; held194 "$M1" "'member_verified', 'dkim_pass', '$W194', '{}', false, 'verified_writer'"
waiting194 "$M2" member_unverified dkim_fail "'$W194'" unverified_writer
waiting194 "$M3" member_unverified dkim_none "'$W194'" unverified_writer
waiting194 "$M4" member_verified dkim_pass "'$O194'" office_member
waiting194 "$M5" external_unverified dkim_none NULL external
waiting194 "$M6" external_verified dkim_pass NULL external
received194 "$M7"; sql_in sender_0197 <<<"UPDATE inbound_mails SET raw_scan_status = 'failed' WHERE id = '$M7';"
held194 "$M7" "'member_verified', 'dkim_pass', '$W194', '{}', false, 'verified_writer'"
received194 "$M8"
# A Bcc copy is not told apart from a recipient re-sending the member's signed mail within the window: it waits for its member.
refused_in sender_0197 "${V194}$HOLD194('member_verified', 'dkim_pass', '$W194', '{not_addressed_to_project,bcc_own}', false, 'verified_writer') WHERE id = '$M8'" "inbound_mails_verified_writer_evidence" "a member's Bcc copy (or a recipient's replay of their signed mail within 24 h) as a verified writer's"
held194 "$M8" "'member_verified', 'dkim_pass', '$W194', '{not_addressed_to_project,bcc_own}', false, 'unverified_writer'"
check_in sender_0197 "SELECT sender_class FROM inbound_mails WHERE id = '$M8'" "unverified_writer" "0197: a member's own Bcc copy of their signed mail waits for that member"
received194 "$M9"; held194 "$M9" "'member_verified', 'dkim_pass', '$W194', '{}', false, 'verified_writer'"
# A subdomain's key (a newsletter service's) aligns relaxed: the label stays verified, the mail waits for its member.
MS="1c000000-0000-4000-8000-000000000194"
received194 "$MS"; held194 "$MS" "'member_verified', 'dkim_pass', '$W194', '{relaxed_alignment}', false, 'unverified_writer'"
received194 "$MR"
received194 "$MB" org_0197_b "$PB194" ab000000-0000-4000-8000-000000000194
held194 "$MB" "'member_verified', 'dkim_pass', '$W194', '{}', false, 'verified_writer'"

# The class needs its evidence.
refused_in sender_0197 "$HOLD194('member_unverified', 'dkim_fail', '$W194', '{}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer whose signature failed"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{not_addressed_to_project}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's signed mail replayed to the project (addressed to someone else)"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{stale_date}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's mail with a stale date"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{message_id_reused}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's mail whose Message-ID was used before"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{already_filed}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's mail already filed"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{}', true, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's automatic mail"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{relaxed_alignment}', false, 'verified_writer') WHERE id = '$MR'" "inbound_mails_verified_writer_evidence" "a verified writer's mail signed by a subdomain's key only (relaxed alignment)"
refused_in sender_0197 "$HOLD194('member_unverified', 'dkim_fail', '$W194', '{relaxed_alignment}', false, 'unverified_writer') WHERE id = '$MR'" "inbound_mails_relaxed_alignment_verified" "relaxed alignment on a mail no signature verified"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{trusted}', false, 'unverified_writer') WHERE id = '$MR'" "inbound_mails_sender_flags_known" "an unknown sender flag, after 0197 widened the list"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{}', false, 'external') WHERE id = '$MR'" "inbound_mails_sender_class_member" "a member's mail classed as an outsider's"
refused_in sender_0197 "$HOLD194('external_verified', 'dkim_pass', NULL, '{}', false, 'office_member') WHERE id = '$MR'" "inbound_mails_sender_class_member" "an outsider's mail classed as a member's"
refused_in sender_0197 "$HOLD194('external_verified', 'dkim_pass', NULL, '{}', false, NULL) WHERE id = '$MR'" "inbound_mails_sender_class_with_trust" "a judged mail with no class"
refused_in sender_0197 "$HOLD194('member_verified', 'dkim_pass', '$W194', '{}', false, 'nobody') WHERE id = '$MR'" "inbound_mails_sender_class_known" "an unknown class"
# Written by the hold, frozen after it.
refused_in sender_0197 "${V194}INSERT INTO inbound_mails (organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, sender_address, sender_trust, sender_reason, sender_user_id, sender_class, expires_at) VALUES ('org_0197_a', '$P194', 'aa000000-0000-4000-8000-000000000194', 'waiting', repeat('f', 64), 100, 'b', 'clean', now(), 'w@buero.at', 'member_verified', 'dkim_pass', '$W194', 'verified_writer', now() + interval '30 days')" "inbound_mails_sender_verdict_held_once" "a verified writer's mail inserted held, past the hold"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET sender_trust = 'member_verified', sender_reason = 'dkim_pass', sender_user_id = '$W194', sender_class = 'verified_writer' WHERE id = '$M5'" "inbound_mails_sender_verdict_frozen" "an outsider's held mail rewritten into a writer's"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET sender_reason = 'dkim_pass', sender_trust = 'member_verified' WHERE id = '$M3'" "inbound_mails_sender_verdict_frozen" "a spoofed From upgraded to a signed one after the hold"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET sender_user_id = '$X194' WHERE id = '$M2'" "inbound_mails_sender_verdict_frozen" "a held mail's member swapped for another"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET sender_class = 'verified_writer' WHERE id = '$M4'" "inbound_mails_sender_verdict_frozen" "a class rewritten after the hold"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET sender_flags = '{}' WHERE id = '$M8'" "inbound_mails_sender_verdict_frozen" "a held mail's flags rewritten"
refused_in sender_0197 "${V194}UPDATE inbound_mails SET status = 'received', raw_storage_key = 'org/org_0197_a/project/$P194/_inbound-mail/$M5/raw.eml' WHERE id = '$M5'" "inbound_mails_sender_verdict_held_once" "a held mail sent back to be judged again"

# Parts: each mail's text, and on M1 a clean attachment and one with a macro.
sql_in sender_0197 <<SQL
INSERT INTO inbound_mail_parts (id, organization_id, project_id, mail_id, position, kind, filename, content_type, size_bytes, sha256, storage_key, scan_status, scanned_at, risk_flags)
SELECT ('2' || substr(m.id::text, 2))::uuid, m.organization_id, m.project_id, m.id, 0, 'message', NULL, 'text/plain', 10, repeat('a', 64), NULL, 'not_applicable', NULL, '{}'::text[]
  FROM inbound_mails m WHERE m.status = 'waiting' AND m.id::text LIKE '1%000000-0000-4000-8000-000000000194';
INSERT INTO inbound_mail_parts (id, organization_id, project_id, mail_id, position, kind, filename, content_type, size_bytes, sha256, storage_key, scan_status, scanned_at, risk_flags) VALUES
  ('3a000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', '$M1', 1, 'attachment', 'S-101.pdf', 'application/pdf', 10, repeat('b', 64),
   'org/org_0197_a/project/$P194/_inbound-mail/$M1/1', 'clean', now(), '{}'),
  ('3b000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', '$M1', 2, 'attachment', 'R.docm', 'application/msword', 10, repeat('c', 64),
   'org/org_0197_a/project/$P194/_inbound-mail/$M1/2', 'clean', now(), '{macro}'),
  ('3c000000-0000-4000-8000-000000000194', 'org_0197_b', '$PB194', '$MB', 1, 'attachment', 'B.pdf', 'application/pdf', 10, repeat('d', 64),
   'org/org_0197_b/project/$PB194/_inbound-mail/$MB/1', 'clean', now(), '{}');
INSERT INTO mail_threads (id, organization_id, project_id, document_id, base_subject, locale, created_by) VALUES
  ('e0000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', NULL, 'Statik', 'de', '$W194');
INSERT INTO mail_thread_follows (id, organization_id, project_id, thread_id, user_id, expires_at) VALUES
  ('f0000000-0000-4000-8000-000000000194', 'org_0197_a', '$P194', 'e0000000-0000-4000-8000-000000000194', '$X194', now() + interval '60 days');
SQL
T1="21000000-0000-4000-8000-000000000194"; T2="22000000-0000-4000-8000-000000000194"; T3="23000000-0000-4000-8000-000000000194"
T4="24000000-0000-4000-8000-000000000194"; T5="25000000-0000-4000-8000-000000000194"; T6="26000000-0000-4000-8000-000000000194"
T7="27000000-0000-4000-8000-000000000194"; A1="3a000000-0000-4000-8000-000000000194"; AM="3b000000-0000-4000-8000-000000000194"
check_in sender_0197 "SELECT count(*) FROM inbound_mail_parts" "15" "0197: every held mail has its text (MR is not held, the older outsider's has none), M1 two attachments, MB one"
DEC194="INSERT INTO inbound_mail_decisions (id, organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path, file_name, thread_action, message_text, screening_release, acknowledged_sender, acknowledged_risk) VALUES"
# A text filed as a new thread, an attachment filed into the root, a dismissal and a restore.
text194() { echo "$DEC194 (${6:-gen_random_uuid()}, 'org_0197_a', '$P194', '$1', '$2', 'file', '$3', '$4', '', 'Verlauf', 'create', 'full', false, $5, false)"; }
file194() { echo "$DEC194 (${7:-gen_random_uuid()}, 'org_0197_a', '$P194', '$1', '$2', 'file', '$3', '$4', '', 'S-101.pdf', NULL, NULL, ${6:-false}, $5, false)"; }
act194() { echo "$DEC194 (gen_random_uuid(), 'org_0197_a', '$P194', '$1', '$2', '$3', '$4', '$5', NULL, NULL, NULL, NULL, false, false, false)"; }
OWN194="inbound_mail_decisions_sender_files_own_verified_mail"
CLAIMED194="inbound_mail_decisions_claimed_sender_releases"

# Class 1: the verified writer's own clean parts are filed without a click, as them.
sql_in sender_0197 <<<"$(text194 "$M1" "$T1" "$W194" sender false "'d1000000-0000-4000-8000-000000000194'");"
sql_in sender_0197 <<<"$(file194 "$M1" "$A1" "$W194" sender false false "'d2000000-0000-4000-8000-000000000194'");"
sql_in sender_0197 <<<"UPDATE inbound_mail_parts SET state = 'filing', decision_id = 'd2000000-0000-4000-8000-000000000194', claim_expires_at = now() + interval '5 minutes' WHERE id = '$A1';"
check_in sender_0197 "SELECT d.via || ':' || d.decided_by FROM inbound_mail_parts p JOIN inbound_mail_decisions d ON d.id = p.decision_id WHERE p.id = '$A1'" "sender:$W194" "0197: a verified writer's attachment is claimed on their own direct decision"
refused_in sender_0197 "${V194}$(file194 "$M1" "$A1" "$X194" sender false)" "$OWN194" "a direct filing of a verified writer's mail by another writer"
refused_in sender_0197 "${V194}$(text194 "$M2" "$T2" "$W194" sender false)" "$OWN194" "a direct filing of a mail whose signature failed"
refused_in sender_0197 "${V194}$(text194 "$M3" "$T3" "$W194" sender false)" "$OWN194" "a direct filing of a spoofed From of a real member, by that member's id"
refused_in sender_0197 "${V194}$(text194 "$M4" "$T4" "$O194" sender false)" "$OWN194" "a direct filing by an office member without write rights"
refused_in sender_0197 "${V194}$(text194 "$M5" "$T5" "$W194" sender false)" "$OWN194" "a direct filing of an outsider's unsigned mail"
refused_in sender_0197 "${V194}$(text194 "$M6" "$T6" "$W194" sender false)" "$OWN194" "a direct filing of an outsider's signed mail"
refused_in sender_0197 "${V194}$(file194 "$M1" "$AM" "$W194" sender false)" "$OWN194" "a direct filing of a part with a macro"
refused_in sender_0197 "${V194}$(text194 "$M7" "$T7" "$W194" sender false)" "$OWN194" "a direct filing of a mail whose raw message did not scan clean"
refused_in sender_0197 "${V194}$(text194 "$M8" "28000000-0000-4000-8000-000000000194" "$W194" sender false)" "$OWN194" "a direct filing of a member's Bcc copy, which a recipient's replay looks like"
refused_in sender_0197 "${V194}$(text194 "$MS" "2c000000-0000-4000-8000-000000000194" "$W194" sender false)" "$OWN194" "a direct filing of a mail a subdomain's key signed"
refused_in sender_0197 "${V194}$(text194 "$M1" "$T1" "system:inbound_mail" sender false)" "$OWN194" "a direct filing by a system actor"
refused_in sender_0197 "$(act194 "$M1" "$A1" dismiss "$W194" sender)" "inbound_mail_decisions_sender_files_clean" "a direct dismissal"
refused_in sender_0197 "$(file194 "$M1" "$A1" "$W194" sender false true)" "inbound_mail_decisions_sender_files_clean" "a direct filing that releases the name check"
refused_in sender_0197 "$DEC194 (gen_random_uuid(), 'org_0197_a', '$P194', '$M1', '$A1', 'file', '$W194', 'sender', '', 'S-101.pdf', NULL, NULL, false, false, true)" "inbound_mail_decisions_sender_files_clean" "a direct filing that accepts a risk"
# A part flagged after its sender's decision is not claimed on it.
sql_in sender_0197 <<<"UPDATE inbound_mail_parts SET content_findings = '{iban}' WHERE id = '$T1';"
refused_in sender_0197 "${V194}UPDATE inbound_mail_parts SET state = 'filing', decision_id = 'd1000000-0000-4000-8000-000000000194', claim_expires_at = now() + interval '5 minutes' WHERE id = '$T1'" "inbound_mail_parts_sender_files_clean" "a text claimed on its sender's decision after the content check found something"

# Class 2: only the member a mail claims releases it, saying they sent it.
refused_in sender_0197 "${V194}$(text194 "$M3" "$T3" "$X194" app true)" "$CLAIMED194" "another writer filing a spoofed From of a member, even acknowledging the sender"
refused_in sender_0197 "${V194}$(text194 "$M2" "$T2" "$W194" app false)" "$CLAIMED194" "the member filing their unverified mail without saying they sent it"
refused_in sender_0197 "${V194}$DEC194 (gen_random_uuid(), 'org_0197_a', '$P194', '$M2', '$T2', 'file', '$X194', 'follow', NULL, NULL, 'append', 'full', false, false, false)" "$CLAIMED194" "a follower appending a mail that claims another member"
refused_in sender_0197 "${V194}$(text194 "$M2" "$T2" "$W194" agent_proposal false)" "$CLAIMED194" "an agent's card filing a member's unverified mail"
sql_in sender_0197 <<<"$(text194 "$M2" "$T2" "$W194" app true);"
sql_in sender_0197 <<<"$(act194 "$M3" "$T3" dismiss "$X194" app); UPDATE inbound_mail_parts SET state = 'dismissed', ended_at = now() WHERE id = '$T3';"
refused_in sender_0197 "${V194}$(act194 "$M3" "$T3" restore "$X194" app)" "$CLAIMED194" "another writer restoring a dismissed spoof of a member"
sql_in sender_0197 <<<"$(act194 "$M3" "$T3" restore "$W194" app);"
check_in sender_0197 "SELECT string_agg(action || ':' || CASE decided_by WHEN '$W194' THEN 'W' ELSE 'X' END || ':' || acknowledged_sender, ',' ORDER BY action) FROM inbound_mail_decisions WHERE mail_id IN ('$M2', '$M3')" \
  "dismiss:X:false,file:W:true,restore:W:false" "0197: the member releases their own mail, any writer dismisses a spoof, and the member restores it"

# Classes 3 and 4: any writer, as before; an outsider's expired mail is not restored.
sql_in sender_0197 <<<"$(text194 "$M4" "$T4" "$X194" app false); $(text194 "$M5" "$T5" "$X194" app false);"
sql_in sender_0197 <<<"$(act194 "$M5" "$T5" dismiss "$X194" app); UPDATE inbound_mail_parts SET state = 'dismissed', ended_at = now() WHERE id = '$T5';"
sql_in sender_0197 <<<"$(act194 "$M5" "$T5" restore "$X194" app);"
sql_in sender_0197 <<<"UPDATE inbound_mail_parts SET state = 'expired', ended_at = now() WHERE id = '$T6';"
refused_in sender_0197 "${V194}$(act194 "$M6" "$T6" restore "$X194" app)" "inbound_mail_decisions_external_expiry_final" "an outsider's expired mail restored"
refused_in sender_0197 "UPDATE inbound_mail_parts SET state = 'filed', filed_at = now() WHERE id = '$T4'" "inbound_mail_parts_decision_iff_filing" "an office member's mail filed without a decision"

# A filed message says who filed it and how; a sender's filing names a signed sender.
ENTRY194="INSERT INTO mail_thread_entries (organization_id, project_id, thread_id, source, inbound_mail_id, sent_at, received_at, heading, sender_trust, filed_by, filed_via) VALUES ('org_0197_a', '$P194', 'e0000000-0000-4000-8000-000000000194', 'inbound'"
refused_in sender_0197 "$ENTRY194, '$M2', now(), now(), 'h1', 'member_unverified', '$W194', 'sender')" "mail_thread_entries_sender_filing_verified" "an entry filed by its sender whose signature failed"
sql_in sender_0197 <<<"$ENTRY194, '$M1', now(), now(), 'h2', 'member_verified', '$W194', 'sender');"

# Tenancy: the composite key, the runtime role's row-level security, and the platform role.
refused_in sender_0197 "$DEC194 (gen_random_uuid(), 'org_0197_a', '$P194', '$MB', '3c000000-0000-4000-8000-000000000194', 'file', '$W194', 'sender', '', 'B.pdf', NULL, NULL, false, false, false)" "inbound_mail_decisions_part_fkey" "a direct filing in one organization naming another's part"
rename_rls_roles
RW194=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d sender_0197 -qtA \
  -c "SET grid.organization_id = 'org_0197_a'" \
  -c "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path, file_name) VALUES ('org_0197_b', '$PB194', '$MB', '3c000000-0000-4000-8000-000000000194', 'file', '$W194', 'sender', '', 'B.pdf')" 2>&1 || true)
if ! grep -q "row-level security" <<<"$RW194"; then
  echo "MIGRATION ASSERTION FAILED on sender_0197: the runtime role in org_0197_a filed directly into org_0197_b ($RW194)" >&2
  exit 1
fi
PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d sender_0197 -qtA -v ON_ERROR_STOP=1 \
  -c "SET grid.organization_id = 'org_0197_a'" \
  -c "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path, file_name) VALUES ('org_0197_a', '$P194', '$M9', '2a000000-0000-4000-8000-000000000194', 'file', '$W194', 'sender', '', 'Notiz')" >/dev/null 2>&1 && {
  echo "MIGRATION ASSERTION FAILED on sender_0197: a text decision without its thread was accepted" >&2
  exit 1
}
PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d sender_0197 -qtA -v ON_ERROR_STOP=1 \
  -c "SET grid.organization_id = 'org_0197_a'" \
  -c "INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path, file_name, thread_action, message_text) VALUES ('org_0197_a', '$P194', '$M9', '2a000000-0000-4000-8000-000000000194', 'file', '$W194', 'sender', '', 'Notiz', 'create', 'full')" >/dev/null || {
  echo "MIGRATION ASSERTION FAILED on sender_0197: the runtime role could not file a verified writer's own mail as them" >&2
  exit 1
}
PL194=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d sender_0197 -qtA -v ON_ERROR_STOP=1 \
  -c "\\set VERBOSITY verbose" -c "BEGIN" -c "SET LOCAL ROLE app_platform" \
  -c "$(text194 "$M2" "$T2" "$W194" sender false)" -c "COMMIT" 2>&1 || true)
if ! grep -q "$OWN194" <<<"$PL194"; then
  echo "MIGRATION ASSERTION FAILED on sender_0197: the platform role (BYPASSRLS) filed a mail whose signature failed directly ($PL194)" >&2
  exit 1
fi
restore_rls_role_names

# Down: refused while a direct filing exists; clean once the project is gone; 0197 applies again.
refused_in sender_0197 "$(cat migrations/0197_sender_class.down.sql)" "reverse 0197 refused" "the down while a direct filing exists"
check_in sender_0197 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'inbound_mails' AND column_name = 'sender_class'" "1" "the refused down dropped nothing"
sql_in sender_0197 <<<"DELETE FROM projects WHERE id IN ('$P194', '$PB194');"
apply_in sender_0197 0197_sender_class.down.sql
check_in sender_0197 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'inbound_mails' AND column_name = 'sender_class'" "0" "0197 down drops the class"
check_in sender_0197 "SELECT count(*) FROM pg_proc WHERE proname = 'inbound_mails_sender_verdict_guard'" "0" "0197 down drops the verdict guard"
check_in sender_0197 "SELECT count(*) FROM pg_proc WHERE proname = 'inbound_mail_decisions_guard' AND prosrc LIKE '%sender%'" "0" "0197 down restores 0196's decision guard"
check_in sender_0197 "SELECT count(*) FROM pg_constraint WHERE conname = 'inbound_mails_sender_flags_known' AND pg_get_constraintdef(oid) LIKE '%relaxed_alignment%'" "0" "0197 down restores 0196's flag list"
apply_in sender_0197 0197_sender_class.sql
check_in sender_0197 "SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conname LIKE 'inbound_mail%' OR conname LIKE 'mail_thread_entries%'" "$AFTER_0197" "0197 applies again after its down"
echo "==> 0197 sender rule and its down migration verified"
# Migration 0198: who wrote a forwarded mail, beside who forwarded it
# (ADR-0137, amendment of 2026-11-03).
#
# On a database of its own, migrated through 0198, with two organizations: the
# original's CHECKs, that an original's Message-ID refuses no mail (it is the
# sender's word: a second open forward of one original, an outsider's claim of
# it, are all held; B2 of the ship review), the scrub trigger and the CHECK
# behind it, the entry's author columns, the runtime role under the deploy's
# role names, and the down.
# ---------------------------------------------------------------------------
echo "==> verifying the 0198 original author and its down migration on original_0198"
migrate_until original_0198 0198_original_author
U195="user_01J0MA1LUSERA00000000000A1"
sql_in original_0198 <<SQL
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('a0000000-0000-4000-8000-000000000195', 'org_0198_a', 'Forward A', '$U195', 'proj_0198_a'),
  ('a1000000-0000-4000-8000-000000000195', 'org_0198_a', 'Forward A2', '$U195', 'proj_0198_a2'),
  ('b0000000-0000-4000-8000-000000000195', 'org_0198_b', 'Forward B', '$U195', 'proj_0198_b');
INSERT INTO inbound_mail_addresses (id, organization_id, project_id, token, slug, created_by) VALUES
  ('aa000000-0000-4000-8000-000000000195', 'org_0198_a', 'a0000000-0000-4000-8000-000000000195', 'aaaaaaaaaaab', '', '$U195'),
  ('ab000000-0000-4000-8000-000000000195', 'org_0198_a', 'a1000000-0000-4000-8000-000000000195', 'aaaaaaaaaaac', '', '$U195'),
  ('ac000000-0000-4000-8000-000000000195', 'org_0198_b', 'b0000000-0000-4000-8000-000000000195', 'bbbbbbbbbbbc', '', '$U195');
INSERT INTO mail_threads (id, organization_id, project_id, document_id, base_subject, participant_domains, locale, created_by) VALUES
  ('ea000000-0000-4000-8000-000000000195', 'org_0198_a', 'a0000000-0000-4000-8000-000000000195', NULL, 'Bescheid', '{}', 'de', '$U195');
SQL
# A waiting mail of project A, with the original's columns as the receive job writes them.
M195="INSERT INTO inbound_mails (organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, expires_at, original_author_address, original_author_name, original_sent_at, original_subject, original_message_id, original_source, sender_address, sender_trust, sender_reason, sender_class)"
A195="'org_0198_a', 'a0000000-0000-4000-8000-000000000195', 'aa000000-0000-4000-8000-000000000195'"
sql_in original_0198 <<<"$M195 VALUES ($A195, 'waiting', repeat('1', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', 'Mag. Huber', now() - interval '40 days', 'Bescheid', 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
check_in original_0198 "SELECT original_author_name || ',' || original_source FROM inbound_mails WHERE original_message_id = 'orig-1@ma37.wien.gv.at'" "Mag. Huber,attachment" "0198: a held mail records its original's author"
refused_in original_0198 "$M195 VALUES ($A195, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'x@y.at', NULL, NULL, NULL, NULL, 'quoted', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external')" "inbound_mails_original_source_known" "an unknown original source"
refused_in original_0198 "$M195 VALUES ($A195, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'x@y.at', NULL, NULL, NULL, NULL, NULL, 'x@fwd.at', 'external_unverified', 'dkim_none', 'external')" "inbound_mails_original_with_source" "an original that says not where it was read"
refused_in original_0198 "$M195 VALUES ($A195, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'x@y.at', NULL, NULL, NULL, 'made-up@y.at', 'inline', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external')" "inbound_mails_original_message_id_attached" "a Message-ID on an inline block, which has none"
refused_in original_0198 "$M195 VALUES ($A195, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now() + interval '1 day', repeat('x', 321), NULL, NULL, NULL, NULL, 'inline', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external')" "inbound_mails_original_lengths" "an author address past 320 characters"
# A second open forward of one original in one project is a mail of its own: the id is the sender's word ...
sql_in original_0198 <<<"$M195 VALUES ($A195, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', 'Huber', NULL, NULL, 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
check_in original_0198 "SELECT count(*) FROM inbound_mails WHERE project_id = 'a0000000-0000-4000-8000-000000000195' AND original_message_id = 'orig-1@ma37.wien.gv.at' AND status = 'waiting'" "2" "0198: two open forwards of one original are two mails"
check_in original_0198 "SELECT count(*) FROM pg_indexes WHERE indexname = 'uniq_inbound_mails_open_original'" "0" "0198: no unique index on an original's Message-ID"
# ... and so are forwards across projects and organizations.
sql_in original_0198 <<<"$M195 VALUES ('org_0198_a', 'a1000000-0000-4000-8000-000000000195', 'ab000000-0000-4000-8000-000000000195', 'waiting', repeat('3', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', NULL, NULL, NULL, 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
sql_in original_0198 <<<"$M195 VALUES ('org_0198_b', 'b0000000-0000-4000-8000-000000000195', 'ac000000-0000-4000-8000-000000000195', 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', NULL, NULL, NULL, 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
check_in original_0198 "SELECT count(*) FROM inbound_mails WHERE original_message_id = 'orig-1@ma37.wien.gv.at'" "4" "0198: one original in three projects of two organizations is four mails"
# Inline forwards carry no Message-ID and are never refused as duplicates.
sql_in original_0198 <<<"$M195 VALUES ($A195, 'waiting', repeat('5', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', 'Huber', NULL, 'Bescheid', NULL, 'inline', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
sql_in original_0198 <<<"$M195 VALUES ($A195, 'waiting', repeat('6', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', 'Huber', NULL, 'Bescheid', NULL, 'inline', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
# Ending a mail clears the author and subject (trigger), and keeps the id and date.
sql_in original_0198 <<<"UPDATE inbound_mails SET status = 'dropped', dropped_reason = 'auto_reply', envelope_from = NULL, sender_address = NULL WHERE delivery_key = repeat('6', 64);"
check_in original_0198 "SELECT coalesce(original_author_address, '-') || ',' || coalesce(original_author_name, '-') || ',' || coalesce(original_subject, '-') || ',' || original_source FROM inbound_mails WHERE delivery_key = repeat('6', 64)" "-,-,-,inline" "0198: a dropped mail keeps no author or subject"
sql_in original_0198 <<<"UPDATE inbound_mails SET status = 'settled', settled_at = now(), sender_address = NULL WHERE delivery_key = repeat('1', 64);"
check_in original_0198 "SELECT coalesce(original_author_name, '-') || ',' || original_message_id || ',' || (original_sent_at IS NOT NULL)::text FROM inbound_mails WHERE delivery_key = repeat('1', 64)" "-,orig-1@ma37.wien.gv.at,true" "0198: a settled mail keeps the original's id and date, not its author"
# A settled first mail blocks no later forward either.
sql_in original_0198 <<<"$M195 VALUES ($A195, 'waiting', repeat('7', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', 'Huber', NULL, NULL, 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external');"
check_in original_0198 "SELECT count(*) FROM inbound_mails WHERE project_id = 'a0000000-0000-4000-8000-000000000195' AND original_message_id = 'orig-1@ma37.wien.gv.at'" "3" "0198: a forward after the first settled is a mail again"
# The CHECK behind the trigger: no path that bypasses it keeps an ended mail's author.
sql_in original_0198 <<<"ALTER TABLE inbound_mails DISABLE TRIGGER inbound_mails_scrub_original;"
refused_in original_0198 "UPDATE inbound_mails SET status = 'dropped', dropped_reason = 'auto_reply', envelope_from = NULL, sender_address = NULL WHERE delivery_key = repeat('5', 64)" "inbound_mails_original_scrubbed" "an ended mail that keeps its original's author"
sql_in original_0198 <<<"ALTER TABLE inbound_mails ENABLE TRIGGER inbound_mails_scrub_original;"
refused_in original_0198 "UPDATE inbound_mails SET status = 'dropped', dropped_reason = 'duplicate_original', sender_address = NULL WHERE delivery_key = repeat('5', 64)" "inbound_mails_dropped_reason_known" "a drop for a duplicate original, which never drops a mail"
# The entry: an inbound entry names its author; an archive entry has none.
E195="INSERT INTO mail_thread_entries (organization_id, project_id, thread_id, source, inbound_mail_id, mail_import_id, sent_at, received_at, heading, sender_trust, filed_by, filed_via, author_address, author_name, author_sent_at, author_message_id) VALUES ('org_0198_a', 'a0000000-0000-4000-8000-000000000195', 'ea000000-0000-4000-8000-000000000195'"
sql_in original_0198 <<<"$E195, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h1', 'member_verified', '$U195', 'app', 'huber@ma37.wien.gv.at', 'Mag. Huber', now() - interval '40 days', 'orig-1@ma37.wien.gv.at');"
refused_in original_0198 "$E195, 'archive', NULL, gen_random_uuid(), now(), now(), 'h2', 'not_checked', '$U195', 'archive_import', 'a@b.at', NULL, NULL, NULL)" "mail_thread_entries_author_named" "an archive entry with an author"
refused_in original_0198 "$E195, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h3', 'member_verified', '$U195', 'app', NULL, NULL, now(), 'orig-2@y.at')" "mail_thread_entries_author_named" "an author id with nobody named"
refused_in original_0198 "$E195, 'inbound', gen_random_uuid(), NULL, now(), now(), 'h4', 'member_verified', '$U195', 'app', NULL, repeat('n', 301), NULL, NULL)" "mail_thread_entries_author_lengths" "an author name past 300 characters"
# The runtime role, under the deploy's names: its organization's rows, and the same refusal.
rename_rls_roles
RW195=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d original_0198 -qtA \
  -c "SET grid.organization_id = 'org_0198_b'" \
  -c "SELECT coalesce(string_agg(DISTINCT organization_id, ','), '') FROM inbound_mails WHERE original_message_id IS NOT NULL" 2>&1)
if [ "$RW195" != "org_0198_b" ]; then
  echo "MIGRATION ASSERTION FAILED on original_0198: the runtime role in org_0198_b saw originals of '$RW195'" >&2
  exit 1
fi
if ! RWDUP195=$(PGPASSWORD="$RUNTIME_PASSWORD" $PGBIN/psql -h 127.0.0.1 -p "$PORT" -U app_rw -d original_0198 -qtA -v ON_ERROR_STOP=1 \
  -c "SET grid.organization_id = 'org_0198_b'" \
  -c "$M195 VALUES ('org_0198_b', 'b0000000-0000-4000-8000-000000000195', 'ac000000-0000-4000-8000-000000000195', 'waiting', repeat('8', 64), 1, 'b', 'clean', now(), now() + interval '1 day', 'huber@ma37.wien.gv.at', NULL, NULL, NULL, 'orig-1@ma37.wien.gv.at', 'attachment', 'x@fwd.at', 'external_unverified', 'dkim_none', 'external')" 2>&1); then
  echo "MIGRATION ASSERTION FAILED on original_0198: the runtime role could not hold a second open forward of one original ($RWDUP195)" >&2
  exit 1
fi
restore_rls_role_names
# Down, and 0198 applies again.
apply_in original_0198 0198_original_author.sql
check_in original_0198 "SELECT count(*) FROM inbound_mails WHERE original_source IS NOT NULL" "8" "0198 re-applied keeps every original"
apply_in original_0198 0198_original_author.down.sql
check_in original_0198 "SELECT count(*) FROM information_schema.columns WHERE (table_name = 'inbound_mails' AND column_name LIKE 'original\_%' AND column_name <> 'original_move_pending_at') OR (table_name = 'mail_thread_entries' AND column_name LIKE 'author\_%')" "0" "0198 down drops the original's and the author's columns"
check_in original_0198 "SELECT count(*) FROM pg_proc WHERE proname = 'inbound_mails_scrub_original'" "0" "0198 down drops the scrub function"
apply_in original_0198 0198_original_author.sql
check_in original_0198 "SELECT count(*) FROM pg_indexes WHERE indexname IN ('inbound_mails_original_message_id_idx', 'mail_thread_entries_author_message_id_idx')" "2" "0198 applies again after its down"
echo "==> 0198 original author and its down migration verified"
# Migration 0199: a dependency that does not answer leaves no frozen guess
# (ADR-0137; B3 of the 2026-11 ship review).
#
# On a database of its own, migrated through 0199: the `sender_unchecked` flag
# is known, never a verified writer's and never shorter than 30 days, and
# `reader_fault_at` is a held mail's only; the down refuses while a mail
# carries the flag (0197 freezes it), and 0199 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0199 receive faults and its down migration on faults_0199"
migrate_until faults_0199 0199_receive_faults
U196="user_01J0MA1LUSERA00000000000A1"
sql_in faults_0199 <<SQL
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('a0000000-0000-4000-8000-000000000196', 'org_0199_a', 'Faults A', '$U196', 'proj_0199_a');
INSERT INTO inbound_mail_addresses (id, organization_id, project_id, token, slug, created_by) VALUES
  ('aa000000-0000-4000-8000-000000000196', 'org_0199_a', 'a0000000-0000-4000-8000-000000000196', 'aaaaaaaaaaad', '', '$U196');
SQL
M196="INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, received_at, expires_at, sender_address, sender_trust, sender_reason, sender_flags, sender_class, reader_fault_at, raw_storage_key)"
A196="'org_0199_a', 'a0000000-0000-4000-8000-000000000196', 'aa000000-0000-4000-8000-000000000196'"
# A mail the directory could not place: an outsider's label, a member's 30 days, said so.
sql_in faults_0199 <<<"$M196 VALUES (gen_random_uuid(), $A196, 'waiting', repeat('1', 64), 1, 'b', 'clean', now(), now(), now() + interval '30 days', 'anna@buero.at', 'external_verified', 'dkim_pass', '{sender_unchecked}', 'external', NULL, NULL);"
check_in faults_0199 "SELECT sender_class || ',' || array_to_string(sender_flags, ',') FROM inbound_mails WHERE delivery_key = repeat('1', 64)" "external,sender_unchecked" "0199: a held mail whose sender could not be checked"
refused_in faults_0199 "$M196 VALUES (gen_random_uuid(), $A196, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now(), now() + interval '14 days', 'anna@buero.at', 'external_verified', 'dkim_pass', '{sender_unchecked}', 'external', NULL, NULL)" "inbound_mails_sender_unchecked_full_window" "an unchecked sender's mail given an outsider's 14 days"
refused_in faults_0199 "$M196 VALUES (gen_random_uuid(), $A196, 'waiting', repeat('2', 64), 1, 'b', 'clean', now(), now(), now() + interval '30 days', 'anna@buero.at', 'external_verified', 'dkim_pass', '{sender_known_somehow}', 'external', NULL, NULL)" "inbound_mails_sender_flags_known" "an unknown sender flag"
refused_in faults_0199 "$M196 VALUES ('c2000000-0000-4000-8000-000000000196', $A196, 'received', repeat('2', 64), 1, 'b', 'clean', now(), now(), now() + interval '30 days', NULL, NULL, NULL, '{}', NULL, now(), 'org/org_0199_a/project/a0000000-0000-4000-8000-000000000196/_inbound-mail/c2000000-0000-4000-8000-000000000196/raw.eml')" "inbound_mails_reader_fault_held" "a reader fault on a mail not yet held"
# The hold's compare-and-set may not make an unchecked sender a verified writer.
sql_in faults_0199 <<<"$M196 VALUES ('c3000000-0000-4000-8000-000000000196', $A196, 'received', repeat('3', 64), 1, 'b', 'clean', now(), now(), now() + interval '30 days', NULL, NULL, NULL, '{}', NULL, NULL, 'org/org_0199_a/project/a0000000-0000-4000-8000-000000000196/_inbound-mail/c3000000-0000-4000-8000-000000000196/raw.eml');"
refused_in faults_0199 "UPDATE inbound_mails SET status = 'waiting', sender_address = 'anna@buero.at', sender_trust = 'member_verified', sender_user_id = '$U196', sender_reason = 'dkim_pass', sender_flags = '{sender_unchecked}', sender_class = 'verified_writer' WHERE delivery_key = repeat('3', 64)" "inbound_mails_sender_unchecked_not_direct" "a verified writer's mail no directory confirmed"
sql_in faults_0199 <<<"UPDATE inbound_mails SET status = 'waiting', sender_address = 'anna@buero.at', sender_trust = 'member_verified', sender_user_id = '$U196', sender_reason = 'dkim_pass', sender_flags = '{sender_unchecked}', sender_class = 'office_member', reader_fault_at = now() WHERE delivery_key = repeat('3', 64);"
check_in faults_0199 "SELECT sender_class || ',' || (reader_fault_at IS NOT NULL)::text FROM inbound_mails WHERE delivery_key = repeat('3', 64)" "office_member,true" "0199: held unchecked for the writers, its text waiting for the reader"
check_in faults_0199 "SELECT count(*) FROM pg_indexes WHERE indexname = 'inbound_mails_reader_fault_idx'" "1" "0199: the re-read sweep's index"
# receive_progress (R10): a received mail keeps what a run learned; a held one may not, and the hold clears it.
sql_in faults_0199 <<<"$M196 VALUES ('c4000000-0000-4000-8000-000000000196', $A196, 'received', repeat('4', 64), 1, 'b', 'clean', now(), now(), now() + interval '30 days', NULL, NULL, NULL, '{}', NULL, NULL, 'org/org_0199_a/project/a0000000-0000-4000-8000-000000000196/_inbound-mail/c4000000-0000-4000-8000-000000000196/raw.eml');"
sql_in faults_0199 <<<"UPDATE inbound_mails SET receive_progress = '{\"scans\": {}}' WHERE delivery_key = repeat('4', 64);"
check_in faults_0199 "SELECT jsonb_typeof(receive_progress) FROM inbound_mails WHERE delivery_key = repeat('4', 64)" "object" "0199: a received mail keeps what a run learned"
refused_in faults_0199 "UPDATE inbound_mails SET receive_progress = '[]' WHERE delivery_key = repeat('4', 64)" "inbound_mails_receive_progress_received" "progress that is not an object"
refused_in faults_0199 "UPDATE inbound_mails SET status = 'waiting', sender_address = 'x@stranger.example', sender_trust = 'external_unverified', sender_reason = 'dkim_none', sender_class = 'external', expires_at = received_at + interval '14 days' WHERE delivery_key = repeat('4', 64)" "inbound_mails_receive_progress_received" "a held mail that still carries a run's progress (it names the sender)"
sql_in faults_0199 <<<"UPDATE inbound_mails SET status = 'waiting', sender_address = 'x@stranger.example', sender_trust = 'external_unverified', sender_reason = 'dkim_none', sender_class = 'external', expires_at = received_at + interval '14 days', receive_progress = NULL WHERE delivery_key = repeat('4', 64);"
check_in faults_0199 "SELECT status FROM inbound_mails WHERE delivery_key = repeat('4', 64)" "waiting" "0199: the hold clears the progress"
# An unchecked sender's mail is classed `external` for want of a member, but may be a member's:
# its expired part keeps a member's restore (0197's `inbound_mail_decisions_external_expiry_final` exempts it).
sql_in faults_0199 <<SQL || { echo "MIGRATION ASSERTION FAILED on faults_0199: an unchecked sender's expired mail could not be restored" >&2; exit 1; }
BEGIN;
INSERT INTO inbound_mail_parts (id, organization_id, project_id, mail_id, position, kind, filename, content_type, size_bytes, sha256, storage_key, scan_status, scanned_at, risk_flags)
SELECT 'c1100000-0000-4000-8000-000000000196', organization_id, project_id, id, 0, 'message', NULL, 'text/plain', 10, repeat('a', 64), NULL, 'not_applicable', NULL, '{}'::text[]
  FROM inbound_mails WHERE delivery_key = repeat('1', 64);
UPDATE inbound_mail_parts SET state = 'expired', ended_at = now() WHERE id = 'c1100000-0000-4000-8000-000000000196';
INSERT INTO inbound_mail_decisions (organization_id, project_id, mail_id, part_id, action, decided_by, via, folder_path, file_name, thread_action, message_text, screening_release, acknowledged_sender, acknowledged_risk)
SELECT organization_id, project_id, mail_id, id, 'restore', '$U196', 'app', NULL, NULL, NULL, NULL, false, false, false
  FROM inbound_mail_parts WHERE id = 'c1100000-0000-4000-8000-000000000196';
ROLLBACK;
SQL
# Down: refused while a mail carries the flag; clean once none does; 0199 applies again.
apply_in faults_0199 0199_receive_faults.sql
refused_in faults_0199 "$(cat migrations/0199_receive_faults.down.sql)" "reverse 0199 refused" "the down while a mail carries sender_unchecked"
sql_in faults_0199 <<<"DELETE FROM inbound_mails WHERE 'sender_unchecked' = ANY (sender_flags);"
apply_in faults_0199 0199_receive_faults.down.sql
check_in faults_0199 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'inbound_mails' AND column_name IN ('reader_fault_at', 'receive_progress')" "0" "0199 down drops reader_fault_at and receive_progress"
refused_in faults_0199 "INSERT INTO inbound_mails (organization_id, project_id, address_id, status, delivery_key, raw_size_bytes, staging_bucket, raw_scan_status, raw_scanned_at, expires_at, sender_address, sender_trust, sender_reason, sender_flags, sender_class) VALUES ($A196, 'waiting', repeat('4', 64), 1, 'b', 'clean', now(), now() + interval '30 days', 'anna@buero.at', 'external_verified', 'dkim_pass', '{sender_unchecked}', 'external')" "inbound_mails_sender_flags_known" "the flag once 0199 is reverted"
apply_in faults_0199 0199_receive_faults.sql
check_in faults_0199 "SELECT count(*) FROM pg_constraint WHERE conname IN ('inbound_mails_sender_unchecked_not_direct', 'inbound_mails_sender_unchecked_full_window', 'inbound_mails_reader_fault_held', 'inbound_mails_receive_progress_received')" "4" "0199 applies again after its down"
echo "==> 0199 receive faults and its down migration verified"
# Migration 0200: every organization has a row and a home country (ADR-0158,
# design 5.1).
#
# On a database of its own, migrated through 0199: an organization that only
# ever made projects, one with a settings row already, and an id that is not
# a WorkOS organization's. The backfill writes the first a row, gives both AT
# and Europe/Vienna, and leaves the stray id out; the CHECKs hold the shape
# (UTC is a zone too); the down drops both columns, and 0200 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying the 0200 home country and its down migration on home_0200"
migrate_before home_0200 0200_organization_home_country
U200="user_01J0MA1LUSERA00000000000A2"
sql_in home_0200 <<SQL
INSERT INTO projects (id, organization_id, name, created_by, collection_name) VALUES
  ('a0000000-0000-4000-8000-000000000200', 'org_0200_projects', 'Only projects', '$U200', 'proj_0200_a'),
  ('a1000000-0000-4000-8000-000000000200', 'legacy_0200', 'Not a WorkOS id', '$U200', 'proj_0200_b');
INSERT INTO organizations (workos_organization_id) VALUES ('org_0200_settings');
SQL
apply_in home_0200 0200_organization_home_country.sql
check_in home_0200 "SELECT string_agg(workos_organization_id || '=' || home_country || '/' || time_zone, ',' ORDER BY workos_organization_id) FROM organizations WHERE workos_organization_id LIKE '%0200%'" "org_0200_projects=AT/Europe/Vienna,org_0200_settings=AT/Europe/Vienna" "0200 backfills a row for an organization that only made projects, and places every row"
refused_in home_0200 "UPDATE organizations SET home_country = 'at' WHERE workos_organization_id = 'org_0200_settings'" "organizations_home_country_iso" "a lower-case home country"
refused_in home_0200 "UPDATE organizations SET time_zone = 'Vienna' WHERE workos_organization_id = 'org_0200_settings'" "organizations_time_zone_shape" "a time zone that is no IANA name"
sql_in home_0200 <<<"UPDATE organizations SET time_zone = 'UTC' WHERE workos_organization_id = 'org_0200_settings';"
sql_in home_0200 <<<"INSERT INTO organizations (workos_organization_id) VALUES ('org_0200_dashboard');"
check_in home_0200 "SELECT coalesce(home_country, 'unplaced') FROM organizations WHERE workos_organization_id = 'org_0200_dashboard'" "unplaced" "0200: a row written later may still lack a country (the S15 gate refuses it)"
apply_in home_0200 0200_organization_home_country.down.sql
check_in home_0200 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'organizations' AND column_name IN ('home_country', 'time_zone')" "0" "0200 down drops home_country and time_zone"
apply_in home_0200 0200_organization_home_country.sql
check_in home_0200 "SELECT count(*) FROM pg_constraint WHERE conname IN ('organizations_home_country_iso', 'organizations_time_zone_shape')" "2" "0200 applies again after its down"
echo "==> 0200 home country and its down migration verified"
# Migration 0201: an existing Austrian project with a stored address and no
# Land gets the Land its Postleitzahl names, as an unconfirmed suggestion
# (ADR-0158).
#
# On a database of its own, migrated through 0200: a Graz address (typed, an
# assumption), a Linz address kept as a confirmed fact, a Zürich address, a
# project without an address, and one already placed. Only the two Austrian
# ones get a Land, with its derivation; the rest stay as they were; a second
# run changes nothing; the down takes back only what 0201 wrote.
# ---------------------------------------------------------------------------
echo "==> verifying the 0201 postal-code Land and its down migration on postal_0201"
migrate_before postal_0201 0201_postal_code_land_backfill
U201="user_01J0MA1LUSERA00000000000A3"
sql_in postal_0201 <<SQL
INSERT INTO projects (id, organization_id, name, created_by, collection_name, profile) VALUES
  ('b0000000-0000-4000-8000-000000000201', 'org_0201', 'Graz', '$U201', 'proj_0201_a',
   '{"facts":{},"goals":{},"unknowns":[],"assumptions":{"site_address":{"value":"Herrengasse 16, 8010 Graz","status":"unconfirmed","reason":"r","source":"onboarding_default","updatedAt":"2026-11-01T00:00:00.000Z"}}}'),
  ('b1000000-0000-4000-8000-000000000201', 'org_0201', 'Linz', '$U201', 'proj_0201_b',
   '{"facts":{"site_address":{"value":"Hauptplatz 1, 4020 Linz","confidence":"confirmed","source":"onboarding","updatedAt":"2026-11-01T00:00:00.000Z"}},"goals":{},"unknowns":[],"assumptions":{}}'),
  ('b2000000-0000-4000-8000-000000000201', 'org_0201', 'Zürich', '$U201', 'proj_0201_c',
   '{"facts":{"site_address":{"value":"Bahnhofstrasse 1, 8001 Zürich","confidence":"confirmed","source":"onboarding","updatedAt":"2026-11-01T00:00:00.000Z"}},"goals":{},"unknowns":[],"assumptions":{}}'),
  ('b3000000-0000-4000-8000-000000000201', 'org_0201', 'No address', '$U201', 'proj_0201_d', '{"facts":{},"goals":{},"unknowns":[],"assumptions":{}}'),
  ('b4000000-0000-4000-8000-000000000201', 'org_0201', 'Placed', '$U201', 'proj_0201_e',
   '{"facts":{"country":{"value":"de","confidence":"confirmed","source":"onboarding","updatedAt":"2026-11-01T00:00:00.000Z"},"site_address":{"value":"Herrengasse 16, 8010 Graz","confidence":"confirmed","source":"onboarding","updatedAt":"2026-11-01T00:00:00.000Z"}},"goals":{},"unknowns":[],"assumptions":{}}');
SQL
apply_in postal_0201 0201_postal_code_land_backfill.sql
LAND="SELECT string_agg(name || '=' || coalesce(profile -> 'assumptions' -> 'federal_state' ->> 'value', '-'), ',' ORDER BY name) FROM projects WHERE organization_id = 'org_0201'"
check_in postal_0201 "$LAND" "Graz=styria,Linz=upper_austria,No address=-,Placed=-,Zürich=-" "0201 places the Austrian addresses only"
check_in postal_0201 "SELECT (profile -> 'assumptions' -> 'federal_state' -> 'evidence' -> 0 ->> 'rule') || ',' || (profile -> 'assumptions' -> 'federal_state' -> 'evidence' -> 0 -> 'inputs' -> 0 ->> 'suggested') || ',' || (profile_prompt_view LIKE '%- federal_state=upper_austria [abgeleitet]%')::text FROM projects WHERE name = 'Linz'" "postal_code,false,true" "0201 records its derivation and the prompt line"
apply_in postal_0201 0201_postal_code_land_backfill.sql
check_in postal_0201 "SELECT sum(profile_version) FROM projects WHERE organization_id = 'org_0201' AND name IN ('Graz', 'Linz')" "4" "0201 runs again without touching a placed project"
apply_in postal_0201 0201_postal_code_land_backfill.down.sql
check_in postal_0201 "$LAND" "Graz=-,Linz=-,No address=-,Placed=-,Zürich=-" "0201 down takes back only its own suggestions"
apply_in postal_0201 0201_postal_code_land_backfill.sql
check_in postal_0201 "$LAND" "Graz=styria,Linz=upper_austria,No address=-,Placed=-,Zürich=-" "0201 applies again after its down"
echo "==> 0201 postal-code Land and its down migration verified"

# ---------------------------------------------------------------------------
# Migration 0202: office base knowledge (ADR-0163).
#
# On a database of its own, migrated through 0202: one entry per document (a
# second work for the same document is refused), the records' identity is
# fixed and revisions are append-only, a document's delete takes its records
# with it, and the down drops the tables so 0202 applies again after it.
# ---------------------------------------------------------------------------
echo "==> verifying the 0202 base knowledge and its down migration on bk_0202"
migrate_until bk_0202 0202_base_knowledge
D200="d0000000-0000-4000-8000-000000000200"
sql_in bk_0202 <<SQL
INSERT INTO documents (id, organization_id, created_by, filename, storage_key, collection_name, status, scope)
  VALUES ('$D200', 'org_0200_a', 'user_0200', 'OENORM_B_1600.pdf', 'k/0200', 'archiv_org_0200_a', 'completed', 'office_shelf');
INSERT INTO knowledge_records (id, organization_id, type, document_id, created_by)
  VALUES ('work_0200', 'org_0200_a', 'work', '$D200', 'user_0200');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by)
  VALUES ('e0000000-0000-4000-8000-000000000200', 'work_0200', 'work', 'org_0200_a', 'user_0200');
SQL
check_in bk_0202 "SELECT count(*) FROM knowledge_records WHERE document_id = '$D200'" "1" "0202: a document's work record"
refused_in bk_0202 "INSERT INTO knowledge_records (id, organization_id, type, document_id, created_by) VALUES ('work_0200_b', 'org_0200_a', 'work', '$D200', 'user_0200')" "knowledge_records_document_type_key" "a second work for one document"
refused_in bk_0202 "INSERT INTO knowledge_records (id, organization_id, type, document_id, created_by) VALUES ('work_0200_p', NULL, 'work', '$D200', 'user_0200')" "knowledge_records_document_is_office" "a platform record that names an office's document"
refused_in bk_0202 "UPDATE knowledge_records SET type = 'edition' WHERE id = 'work_0200'" "only head_revision_id" "a record's identity rewritten"
refused_in bk_0202 "UPDATE knowledge_revisions SET created_by = 'someone' WHERE record_id = 'work_0200'" "append-only" "a revision rewritten"
sql_in bk_0202 <<<"UPDATE knowledge_records SET head_revision_id = 'e0000000-0000-4000-8000-000000000200' WHERE id = 'work_0200';"
check_in bk_0202 "SELECT head_revision_id FROM knowledge_records WHERE id = 'work_0200'" "e0000000-0000-4000-8000-000000000200" "0202: the head moves"
# Removal is the document's delete: the records and their revisions go with it.
sql_in bk_0202 <<<"DELETE FROM documents WHERE id = '$D200';"
check_in bk_0202 "SELECT (SELECT count(*) FROM knowledge_records) + (SELECT count(*) FROM knowledge_revisions)" "0" "0202: a document's delete leaves no record or revision"
# Down: the tables go; 0202 applies again.
apply_in bk_0202 0202_base_knowledge.down.sql
check_in bk_0202 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'knowledge\\_%'" "0" "0202 down drops every knowledge table"
apply_in bk_0202 0202_base_knowledge.sql
check_in bk_0202 "SELECT count(*) FROM pg_indexes WHERE indexname = 'knowledge_records_document_type_key'" "1" "0202 applies again after its down"
echo "==> 0202 base knowledge and its down migration verified"

# ---------------------------------------------------------------------------
# Migration 0205: the platform's base knowledge in the same records (ADR-0165).
#
# On a database of its own, migrated through 0205: a platform revision goes
# only into a draft change request, an approval never comes from a revision's
# author, a platform head moves only with a stable release move, an office
# owns no territory, and the down restores 0202's shape so 0205 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying the 0205 platform base knowledge and its down migration on pbk_0205"
migrate_until pbk_0205 0205_platform_base_knowledge
CR="c0000000-0000-4000-8000-000000000205"
RV="e0000000-0000-4000-8000-000000000205"
sql_in pbk_0205 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'AT territories', 'AT', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('AT-6', NULL, 'territory', 'AT', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RV', 'AT-6', 'territory', NULL, 'user_author', '$CR');
INSERT INTO knowledge_territory_revisions (revision_id, record_id, organization_id, kind, name, parent_ids)
  VALUES ('$RV', 'AT-6', NULL, 'state', 'Steiermark', '{AT}');
SQL
refused_in pbk_0205 "INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES ('AT-7', 'org_0205', 'territory', 'user_author')" "knowledge_records_platform_types" "an office owning a territory"
refused_in pbk_0205 "INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES ('work_p0205', NULL, 'work', 'user_author')" "knowledge_records_country_is_platform" "a platform record without a country"
refused_in pbk_0205 "INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by) VALUES ('e0000000-0000-4000-8000-000000000213', 'AT-6', 'territory', NULL, 'user_author')" "knowledge_revisions_change_request_is_platform" "a platform revision outside a change request"
refused_in pbk_0205 "UPDATE knowledge_records SET head_revision_id = '$RV' WHERE id = 'AT-6'" "only with a stable release move" "a platform head moved without a release"
sql_in pbk_0205 <<<"UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$CR';"
refused_in pbk_0205 "INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id) VALUES ('e0000000-0000-4000-8000-000000000223', 'AT-6', 'territory', NULL, 'user_author', '$CR')" "into a draft change request" "a revision into a submitted request"
refused_in pbk_0205 "INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_author', 'domain_expert', 'app')" "revision they wrote" "an author approving their own request"
refused_in pbk_0205 "INSERT INTO knowledge_release_moves (record_id, channel, action, to_revision_id, change_request_id, released_by, decision_source) VALUES ('AT-6', 'stable', 'publish', '$RV', '$CR', 'user_expert', 'app')" "only an approved change request" "a publish before the approval"
sql_in pbk_0205 <<SQL
INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_expert', 'domain_expert', 'app');
UPDATE knowledge_change_requests SET status = 'approved' WHERE id = '$CR';
INSERT INTO knowledge_release_moves (record_id, channel, action, to_revision_id, change_request_id, released_by, decision_source)
  VALUES ('AT-6', 'stable', 'publish', '$RV', '$CR', 'user_expert', 'app');
UPDATE knowledge_records SET head_revision_id = '$RV' WHERE id = 'AT-6';
SQL
check_in pbk_0205 "SELECT head_revision_id FROM knowledge_records WHERE id = 'AT-6'" "$RV" "0205: a stable release moves the head"
refused_in pbk_0205 "UPDATE knowledge_release_moves SET reason = 'x'" "append-only" "a release move rewritten"
refused_in pbk_0205 "UPDATE knowledge_records SET country_id = 'DE' WHERE id = 'AT-6'" "only head_revision_id" "a platform record's country rewritten"
# Down: 0202's shape comes back, without the platform's rows; 0205 applies again.
apply_in pbk_0205 0205_platform_base_knowledge.down.sql
check_in pbk_0205 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_records' AND column_name = 'country_id'" "0" "0205 down drops the country column"
check_in pbk_0205 "SELECT count(*) FROM knowledge_records" "0" "0205 down removes the platform's records"
apply_in pbk_0205 0205_platform_base_knowledge.sql
check_in pbk_0205 "SELECT count(*) FROM information_schema.tables WHERE table_name = 'knowledge_release_moves'" "1" "0205 applies again after its down"
echo "==> 0205 platform base knowledge and its down migration verified"

# ---------------------------------------------------------------------------
# 0206: an edition's transition is a table (an object) or absent, and a work
# says from when its history is held; the down drops both and 0206 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0206 editions in time and its down migration on te_0206"
migrate_until te_0206 0206_editions_in_time
sql_in te_0206 <<<"INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES ('work_t0206', 'org_0206', 'work', 'user_author');"
refused_in te_0206 "INSERT INTO knowledge_edition_revisions (revision_id, record_id, organization_id, work_id, label, transition) VALUES (gen_random_uuid(), 'edition_t0206', 'org_0206', 'work_t0206', 'x', '[]')" "knowledge_edition_revisions_transition_object" "a transition that is not a table"
check_in te_0206 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_work_revisions' AND column_name = 'history_available_from'" "1" "0206 adds the history start"
apply_in te_0206 0206_editions_in_time.down.sql
check_in te_0206 "SELECT count(*) FROM information_schema.columns WHERE column_name IN ('transition', 'history_available_from') AND table_name LIKE 'knowledge_%'" "0" "0206 down drops both columns"
apply_in te_0206 0206_editions_in_time.sql
check_in te_0206 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_edition_revisions' AND column_name = 'transition'" "1" "0206 applies again after its down"
echo "==> 0206 editions in time and its down migration verified"

# ---------------------------------------------------------------------------
# 0208: four eyes on the claim review, and a verdict says how it was given.
#
# On a database migrated through 0207, a verdict written before 0208 has no
# source and keeps it (verdicts are append-only); after 0208 an author's verdict
# is refused, a new verdict without a source is refused, and another person's
# lands. The down restores 0205's trigger and drops the column; 0208 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0208 review four eyes and its down migration on rv_0208"
migrate_before rv_0208 0208_review_four_eyes
CR="c0000000-0000-4000-8000-000000000208"
RV="e0000000-0000-4000-8000-000000000208"
sql_in rv_0208 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'AT territories', 'AT', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('AT-6', NULL, 'territory', 'AT', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RV', 'AT-6', 'territory', NULL, 'user_author', '$CR');
INSERT INTO knowledge_territory_revisions (revision_id, record_id, organization_id, kind, name, parent_ids)
  VALUES ('$RV', 'AT-6', NULL, 'state', 'Steiermark', '{AT}');
UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$CR';
INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer)
  VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_author');
SQL
apply_in rv_0208 0208_review_four_eyes.sql
check_in rv_0208 "SELECT count(*) FROM knowledge_review_decisions WHERE decision_source IS NULL" "1" "0208 keeps a verdict written before it, without a source"
refused_in rv_0208 "INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, decision_source) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_author', 'agent')" "revision they wrote" "an author reviewing their own request"
refused_in rv_0208 "INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_expert')" "knowledge_review_decisions_source_given" "a new verdict without a source"
refused_in rv_0208 "INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, decision_source) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_expert', 'model')" "knowledge_review_decisions_source_known" "a source nobody defined"
sql_in rv_0208 <<<"INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, decision_source) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_expert', 'agent');"
check_in rv_0208 "SELECT decision_source FROM knowledge_review_decisions WHERE reviewer = 'user_expert'" "agent" "0208: another person's verdict lands with its source"
apply_in rv_0208 0208_review_four_eyes.down.sql
check_in rv_0208 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_review_decisions' AND column_name = 'decision_source'" "0" "0208 down drops the source"
sql_in rv_0208 <<<"INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_author');"
apply_in rv_0208 0208_review_four_eyes.sql
check_in rv_0208 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_review_decisions' AND column_name = 'decision_source'" "1" "0208 applies again after its down"
echo "==> 0208 review four eyes and its down migration verified"

# ---------------------------------------------------------------------------
# Migration 0209: citation captures and the reviewer's source check (ADR-0170).
#
# On a database of its own, migrated through 0209: a capture goes only into a
# draft and is never rewritten, a fetched capture names its source, and an
# approval waits until a verdict says an operator-supplied capture's source
# was checked, by someone other than the revision's author (0208's four-eyes
# trigger refuses an author's verdict outright). The down drops both, and 0209
# applies again.
# ---------------------------------------------------------------------------
echo "==> verifying the 0209 citation captures and their down migration on cc_0209"
migrate_until cc_0209 0209_knowledge_citation_captures
CR="c0000000-0000-4000-8000-000000000209"
RV="e0000000-0000-4000-8000-000000000209"
CAP="a0000000-0000-4000-8000-000000000209"
SHA="0000000000000000000000000000000000000000000000000000000000000209"
sql_in cc_0209 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'AT-9', 'AT', 'user_author');
INSERT INTO knowledge_citation_captures (id, change_request_id, basis, url, sha256, byte_size, text, retrieved_at, created_by)
  VALUES ('$CAP', '$CR', 'operator_supplied', 'https://www.wien.gv.at/ma37', '$SHA', 4, 'Wien', now(), 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('AT-9', NULL, 'territory', 'AT', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id, provenance)
  VALUES ('$RV', 'AT-9', 'territory', NULL, 'user_author', '$CR', '{"citations": [{"captureId": "$CAP", "quote": "Wien"}]}');
INSERT INTO knowledge_territory_revisions (revision_id, record_id, organization_id, kind, name, parent_ids)
  VALUES ('$RV', 'AT-9', NULL, 'state', 'Wien', '{AT}');
SQL
refused_in cc_0209 "INSERT INTO knowledge_citation_captures (id, change_request_id, basis, url, sha256, byte_size, retrieved_at, created_by) VALUES (gen_random_uuid(), '$CR', 'fetched', 'https://www.ris.bka.gv.at/x', '$SHA', 1, now(), 'user_author')" "knowledge_citation_captures_fetched_has_source" "a fetched capture without its source"
refused_in cc_0209 "UPDATE knowledge_citation_captures SET text = 'Graz'" "append-only" "a capture rewritten"
sql_in cc_0209 <<<"UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$CR';"
refused_in cc_0209 "INSERT INTO knowledge_citation_captures (id, change_request_id, basis, url, sha256, byte_size, retrieved_at, created_by) VALUES (gen_random_uuid(), '$CR', 'operator_supplied', 'https://x.example/', '$SHA', 1, now(), 'user_author')" "into a draft change request" "a capture into a submitted request"
sql_in cc_0209 <<<"INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, decision_source) VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_expert', 'app');"
refused_in cc_0209 "INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_expert', 'domain_expert', 'app')" "no reviewer checked" "an approval before the operator-supplied source was checked"
sql_in cc_0209 <<SQL
INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, source_checked, decision_source)
  VALUES (gen_random_uuid(), '$CR', '$RV', 'name', 'accepted', 'user_expert', true, 'app');
INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_expert', 'domain_expert', 'app');
SQL
check_in cc_0209 "SELECT count(*) FROM knowledge_approvals WHERE change_request_id = '$CR'" "1" "0209: the approval counts once the source was checked"
apply_in cc_0209 0209_knowledge_citation_captures.down.sql
check_in cc_0209 "SELECT count(*) FROM information_schema.tables WHERE table_name = 'knowledge_citation_captures'" "0" "0209 down drops the captures"
apply_in cc_0209 0209_knowledge_citation_captures.sql
check_in cc_0209 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_review_decisions' AND column_name = 'source_checked'" "1" "0209 applies again after its down"
echo "==> 0209 citation captures and their down migration verified"

# ---------------------------------------------------------------------------
# Migration 0210: the official address registers in the cell (ADR-0172).
#
# On a database of its own, migrated through 0210: an active release needs its
# rows counted and a time, a register has one active release at a time, an
# entry needs both keys, a release's entries go with it, and the down drops
# both tables so 0210 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying the 0210 address register and its down migration on addr_0210"
migrate_until addr_0210 0210_address_register
REL="a0000000-0000-4000-8000-000000000210"
sql_in addr_0210 <<SQL
INSERT INTO address_register_releases (id, register, country_id, reference_date, attribution) VALUES ('$REL', 'at-bev', 'AT', '2025-10-01', 'BEV');
INSERT INTO address_register_entries (release_id, address_id, municipality_code, municipality_name, postcode, street_name, house_number, street_key, house_key, place_keys)
  VALUES ('$REL', '5734380', '60101', 'Graz', '8010', 'Herrengasse', '16', 'herrengasse', '16', '{graz}');
SQL
refused_in addr_0210 "UPDATE address_register_releases SET status = 'active' WHERE id = '$REL'" "address_register_releases_active_has_rows" "a release active with no rows counted"
sql_in addr_0210 <<<"UPDATE address_register_releases SET status = 'active', entry_count = 1, activated_at = now() WHERE id = '$REL';"
refused_in addr_0210 "INSERT INTO address_register_releases (register, country_id, reference_date, attribution, status, entry_count, activated_at) VALUES ('at-bev', 'AT', '2026-04-01', 'BEV', 'active', 1, now())" "address_register_releases_one_active" "a second active release of one register"
refused_in addr_0210 "INSERT INTO address_register_releases (register, country_id, reference_date, attribution) VALUES ('BEV', 'AT', '2026-04-01', 'BEV')" "address_register_releases_register_shape" "a register id of the wrong shape"
refused_in addr_0210 "INSERT INTO address_register_entries (release_id, address_id, municipality_code, municipality_name, postcode, street_name, house_number, street_key, house_key) VALUES ('$REL', 'x', '60101', 'Graz', '8010', 'Herrengasse', '16', '', '16')" "address_register_entries_keys_present" "an entry without a street key"
sql_in addr_0210 <<<"DELETE FROM address_register_releases WHERE id = '$REL';"
check_in addr_0210 "SELECT count(*) FROM address_register_entries" "0" "0210: a release's entries go with it"
check_in addr_0210 "SELECT string_agg(relname || ':' || relrowsecurity, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('address_register_entries', 'address_register_releases')" "address_register_entries:true,address_register_releases:true" "0210: both tables are under row-level security"
apply_in addr_0210 0210_address_register.down.sql
check_in addr_0210 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'address_register_%'" "0" "0210 down drops both tables"
apply_in addr_0210 0210_address_register.sql
check_in addr_0210 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'address_register_%'" "2" "0210 applies again after its down"
echo "==> 0210 address register and its down migration verified"

# ---------------------------------------------------------------------------
# 0211: relations are records (ADR-0168): a relation names two records of its
# owner, a mode only for makes_binding; the down removes relations and their
# records and the record type, and 0211 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0211 country pack and its down migration on cp_0211"
migrate_until cp_0211 0211_country_pack
sql_in cp_0211 <<'SQL'
INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES
  ('work:t0211-ordinance', 'org_0211', 'work', 'user_author'),
  ('work:t0211-norm', 'org_0211', 'work', 'user_author'),
  ('relation:t0211', 'org_0211', 'relation', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by)
  VALUES ('00000000-0000-4000-8000-000000000211', 'relation:t0211', 'relation', 'org_0211', 'user_author');
INSERT INTO knowledge_relation_revisions (revision_id, record_id, organization_id, relation_type, mode, from_id, from_type, to_id, to_type)
  VALUES ('00000000-0000-4000-8000-000000000211', 'relation:t0211', 'org_0211', 'makes_binding', 'declared',
          'work:t0211-ordinance', 'work', 'work:t0211-norm', 'work');
SQL
refused_in cp_0211 "INSERT INTO knowledge_relation_revisions (revision_id, record_id, organization_id, relation_type, mode, from_id, from_type, to_id, to_type) VALUES (gen_random_uuid(), 'relation:t0211', 'org_0211', 'supersedes', 'declared', 'work:t0211-ordinance', 'work', 'work:t0211-norm', 'work')" "knowledge_relation_revisions_mode_iff_binding" "a mode on a relation that makes nothing binding"
refused_in cp_0211 "UPDATE knowledge_relation_revisions SET provision = 'x'" "append-only" "a relation rewritten"
apply_in cp_0211 0211_country_pack.down.sql
check_in cp_0211 "SELECT count(*) FROM information_schema.tables WHERE table_name = 'knowledge_relation_revisions'" "0" "0211 down drops the relation bodies"
check_in cp_0211 "SELECT count(*) FROM knowledge_records WHERE type = 'relation'" "0" "0211 down removes the relation records"
check_in cp_0211 "SELECT count(*) FROM knowledge_records WHERE id LIKE 'work:t0211-%'" "2" "0211 down keeps the works"
apply_in cp_0211 0211_country_pack.sql
check_in cp_0211 "SELECT count(*) FROM information_schema.tables WHERE table_name = 'knowledge_relation_revisions'" "1" "0211 applies again after its down"
echo "==> 0211 country pack and its down migration verified"

# ---------------------------------------------------------------------------
# Migration 0212: the country onboarding tooling (ADR-0174).
#
# On a database of its own, migrated through 0212: a source record's body
# names exact hosts and a known protocol, and is never rewritten; only a source
# holds a credential, one active at a time; a monitor's request names its
# source, and a second open one for the same source is refused; an advice
# policy is published only with counsel's approval and a site-keyed source
# only with a privacy reviewer's, whatever path reaches the release move. The
# down drops it all, and 0212 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying the 0212 onboarding tooling and its down migration on ot_0212"
migrate_until ot_0212 0212_country_onboarding_tooling
CR="c0000000-0000-4000-8000-000000000212"
RV="e0000000-0000-4000-8000-000000000212"
RS="e1000000-0000-4000-8000-000000000212"
sql_in ot_0212 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'XA', 'XA', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('source:xa-gazette', NULL, 'source', 'XA', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RV', 'source:xa-gazette', 'source', NULL, 'user_author', '$CR');
INSERT INTO knowledge_source_revisions (revision_id, record_id, organization_id, title, territory_id, protocol, format, hosts,
  data_flow, monitor_kind, monitor_interval_hours, licence, config)
  VALUES ('$RV', 'source:xa-gazette', NULL, 'Gazette', 'XA', 'ogc', 'geojson', '{geo.xa.example}', 'site_keyed', 'sha256', 24, 'public_open', '{}');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('ruleset:xa-advice', NULL, 'ruleset', 'XA', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RS', 'ruleset:xa-advice', 'ruleset', NULL, 'user_author', '$CR');
INSERT INTO knowledge_ruleset_revisions (revision_id, record_id, organization_id, purpose, territory_ids, valid_from, payload_schema, payload)
  VALUES ('$RS', 'ruleset:xa-advice', NULL, 'advice_policy', '{XA}', '2026-01-01', 'advice_policy.v1', '{"topics": {"deadlines": "hedge"}}');
SQL
refused_in ot_0212 "INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES ('source:office', 'org_a', 'source', 'user_a')" "knowledge_records_platform_types" "an office owning a source"
refused_in ot_0212 "UPDATE knowledge_source_revisions SET hosts = '{evil.example}'" "append-only" "a source's hosts rewritten"
refused_in ot_0212 "INSERT INTO knowledge_source_credentials (id, record_id, secret_owner_id, secret_backend, encrypted_key, key_hint, set_by, decision_source) VALUES (gen_random_uuid(), 'ruleset:xa-advice', 'org_p', 'local-aes-gcm', 'x', '…1234', 'user_a', 'app')" "belongs to a platform source record" "a credential on a ruleset"
refused_in ot_0212 "INSERT INTO knowledge_ruleset_revisions (revision_id, record_id, organization_id, purpose, territory_ids, valid_from, payload_schema, payload) VALUES (gen_random_uuid(), 'ruleset:xa-advice', NULL, 'classification', '{XA}', '2026-01-01', 'advice_policy.v1', '{}')" "knowledge_ruleset_revisions_prompt_purpose" "an advice policy under another purpose"
sql_in ot_0212 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by, origin, source_record_id, monitor_finding)
  VALUES (gen_random_uuid(), 'Monitor', 'XA', 'system:source-monitor', 'monitor', 'source:xa-gazette', '{"needs": []}');
SQL
refused_in ot_0212 "INSERT INTO knowledge_change_requests (id, title, country_id, created_by, origin, source_record_id, monitor_finding) VALUES (gen_random_uuid(), 'Monitor', 'XA', 'system:source-monitor', 'monitor', 'source:xa-gazette', '{}')" "knowledge_change_requests_one_open_per_source" "a second open monitor request for one source"
refused_in ot_0212 "INSERT INTO knowledge_change_requests (id, title, country_id, created_by, origin) VALUES (gen_random_uuid(), 'Monitor', 'XA', 'user_a', 'monitor')" "knowledge_change_requests_monitor_names_source" "a monitor request that names no source"
check_in ot_0212 "SELECT array_to_string(knowledge_required_approval_roles('$CR'), ',')" "counsel,privacy_reviewer" "0212: an advice policy needs counsel, a site-keyed source a privacy reviewer"
sql_in ot_0212 <<SQL
UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$CR';
INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_expert', 'domain_expert', 'app');
UPDATE knowledge_change_requests SET status = 'approved' WHERE id = '$CR';
SQL
refused_in ot_0212 "INSERT INTO knowledge_release_moves (record_id, channel, action, to_revision_id, change_request_id, released_by, decision_source) VALUES ('ruleset:xa-advice', 'preview', 'publish', '$RS', '$CR', 'user_expert', 'app')" "needs an approval as counsel, privacy_reviewer" "a publish without counsel and a privacy reviewer"
sql_in ot_0212 <<SQL
UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$CR';
INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_counsel', 'counsel', 'app');
INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), '$CR', 'user_privacy', 'privacy_reviewer', 'app');
UPDATE knowledge_change_requests SET status = 'approved' WHERE id = '$CR';
INSERT INTO knowledge_release_moves (record_id, channel, action, to_revision_id, change_request_id, released_by, decision_source)
  VALUES ('ruleset:xa-advice', 'preview', 'publish', '$RS', '$CR', 'user_expert', 'app');
SQL
check_in ot_0212 "SELECT count(*) FROM knowledge_release_moves WHERE change_request_id = '$CR'" "1" "0212: the publish runs once counsel and the privacy reviewer approved"
apply_in ot_0212 0212_country_onboarding_tooling.down.sql
check_in ot_0212 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'knowledge_source_%'" "0" "0212 down drops the source tables"
check_in ot_0212 "SELECT count(*) FROM knowledge_records WHERE id IN ('source:xa-gazette', 'ruleset:xa-advice')" "0" "0212 down drops the source and advice records"
apply_in ot_0212 0212_country_onboarding_tooling.sql
check_in ot_0212 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_change_requests' AND column_name = 'origin'" "1" "0212 applies again after its down"
echo "==> 0212 onboarding tooling and its down migration verified"
# 0213: the knowledge context (ADR-0173): coverage on a territory revision and
# a work's connecting factor are closed vocabularies; an edition use and a
# confirmed Steckbrief are tenant tables under row-level security; the down
# drops both tables and both columns, and 0213 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0213 knowledge context and its down migration on kc_0213"
migrate_until kc_0213 0213_knowledge_context
refused_in kc_0213 "INSERT INTO knowledge_territory_revisions (revision_id, record_id, organization_id, kind, name, coverage_level) VALUES (gen_random_uuid(), 'DE', NULL, 'country', 'Deutschland', 'partial')" "knowledge_territory_revisions_coverage_known" "a coverage level nobody defined"
refused_in kc_0213 "INSERT INTO knowledge_work_revisions (revision_id, record_id, organization_id, kind, title, connects_by) VALUES (gen_random_uuid(), 'work:hoai', NULL, 'ordinance', 'HOAI', '{nationality}')" "knowledge_work_revisions_connects_by_known" "a connecting factor nobody defined"
refused_in kc_0213 "INSERT INTO knowledge_work_revisions (revision_id, record_id, organization_id, kind, title, connects_by) VALUES (gen_random_uuid(), 'work:hoai', NULL, 'ordinance', 'HOAI', '{}')" "knowledge_work_revisions_connects_by_known" "a work that attaches to nothing"
refused_in kc_0213 "INSERT INTO message_edition_uses (message_id, organization_id, work_id, role) VALUES (gen_random_uuid(), 'org_0213', 'work:x', 'binding')" "message_edition_uses_message_id_fkey" "an edition use of a message that does not exist"
refused_in kc_0213 "INSERT INTO message_edition_uses (message_id, organization_id, work_id, role) VALUES (gen_random_uuid(), 'org_0213', 'work:x', 'decisive')" "message_edition_uses_role_known" "a role nobody defined"
check_in kc_0213 "SELECT string_agg(relname || ':' || relrowsecurity, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('message_edition_uses', 'project_base_confirmations')" "message_edition_uses:true,project_base_confirmations:true" "0213: both tables are under row-level security"
apply_in kc_0213 0213_knowledge_context.down.sql
check_in kc_0213 "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('message_edition_uses', 'project_base_confirmations')" "0" "0213 down drops both tables"
check_in kc_0213 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_territory_revisions' AND column_name = 'coverage_level'" "0" "0213 down drops the coverage column"
apply_in kc_0213 0213_knowledge_context.sql
check_in kc_0213 "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('message_edition_uses', 'project_base_confirmations')" "2" "0213 applies again after its down"
echo "==> 0213 knowledge context and its down migration verified"
# 0218: four eyes in the database (architecture review of platform governance).
# It refuses to run while a request is approved without a domain expert, and
# names the way out; once that request is rejected it applies, and from then on
# a request starts as a draft and moves only along its lifecycle. The down
# drops the status trigger, and 0218 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0218 four eyes in the database and its down migration on fe_0218"
migrate_before fe_0218 0218_knowledge_four_eyes_in_the_database
STUCK=c0000000-0000-4000-8000-000000000218
sql_in fe_0218 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$STUCK', 'approved alone in the old way', 'AT', 'user_author');
UPDATE knowledge_change_requests SET status = 'approved' WHERE id = '$STUCK';
SQL
refused_in fe_0218 "$(cat migrations/0218_knowledge_four_eyes_in_the_database.sql)" "approved without a domain expert; reject them first" "0218 runs over a request approved without a domain expert"
sql_in fe_0218 <<<"UPDATE knowledge_change_requests SET status = 'rejected', decided_at = now() WHERE id = '$STUCK';"
apply_in fe_0218 0218_knowledge_four_eyes_in_the_database.sql
apply_in fe_0218 0218_knowledge_four_eyes_in_the_database.sql   # up twice: idempotent, the trigger included
refused_in fe_0218 "INSERT INTO knowledge_change_requests (id, title, country_id, created_by, status) VALUES (gen_random_uuid(), 'born published', 'AT', 'user_author', 'published')" "starts as a draft" "a request inserted as published"
DRAFT=c1000000-0000-4000-8000-000000000218
sql_in fe_0218 <<<"INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$DRAFT', 'a draft', 'AT', 'user_author');"
refused_in fe_0218 "UPDATE knowledge_change_requests SET status = 'published' WHERE id = '$DRAFT'" "does not move from draft to published" "a draft published without approval"
refused_in fe_0218 "UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = '$STUCK'" "does not move from rejected to submitted" "a rejected request resubmitted"
check_in fe_0218 "SELECT array_to_string(knowledge_required_approval_roles('$DRAFT'), ',')" "domain_expert" "0218: every request needs a domain expert"
apply_in fe_0218 0218_knowledge_four_eyes_in_the_database.down.sql
check_in fe_0218 "SELECT count(*) FROM pg_trigger WHERE tgname = 'knowledge_change_requests_status_moves'" "0" "0218 down drops the status trigger"
check_in fe_0218 "SELECT coalesce(array_to_string(knowledge_required_approval_roles('$DRAFT'), ','), '')" "" "0218 down: a request without an advice policy or a site-keyed source needs no named role again"
apply_in fe_0218 0218_knowledge_four_eyes_in_the_database.sql
check_in fe_0218 "SELECT count(*) FROM pg_trigger WHERE tgname = 'knowledge_change_requests_status_moves'" "1" "0218 applies again after its down"
echo "==> 0218 four eyes in the database and its down migration verified"
# ---------------------------------------------------------------------------
# 0219: one parents field for a territory (design §3.2). A revision stored with
# the two lists before it gets both in `parents`, undated first; the EU
# entitlement reads `parents`; the down drops the column and 0219 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0219 territory parents and its down migration on tp_0219"
migrate_before tp_0219 0219_territory_parents
CR="c0000000-0000-4000-8000-000000000219"
RV="e0000000-0000-4000-8000-000000000219"
sql_in tp_0219 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'XA territories', 'XA', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('XA-1', NULL, 'territory', 'XA', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RV', 'XA-1', 'territory', NULL, 'user_author', '$CR');
INSERT INTO knowledge_territory_revisions (revision_id, record_id, organization_id, kind, name, parent_ids, dated_parents)
  VALUES ('$RV', 'XA-1', NULL, 'state', 'Eins', '{XA}', '[{"id": "EU", "validFrom": "1995-01-01"}]');
SQL
apply_in tp_0219 0219_territory_parents.sql
check_in tp_0219 "SELECT parents::text FROM knowledge_territory_revisions WHERE revision_id = '$RV'" '[{"id": "XA"}, {"id": "EU", "validFrom": "1995-01-01"}]' "0219 folds both lists into parents, undated first"
check_in tp_0219 "SELECT (pg_get_functiondef('knowledge_country_entitled(text)'::regprocedure) LIKE '%t.parents @>%')::text" "true" "0219: the EU entitlement reads parents"
refused_in tp_0219 "UPDATE knowledge_territory_revisions SET parents = '[]'" "append-only" "a parents list rewritten"
apply_in tp_0219 0219_territory_parents.down.sql
check_in tp_0219 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_territory_revisions' AND column_name = 'parents'" "0" "0219 down drops parents"
apply_in tp_0219 0219_territory_parents.sql
check_in tp_0219 "SELECT jsonb_array_length(parents) FROM knowledge_territory_revisions WHERE revision_id = '$RV'" "2" "0219 applies again after its down"
echo "==> 0219 territory parents and its down migration verified"
# ---------------------------------------------------------------------------
# 0221: an edition's scope (ADR-0178) is a JSON object or absent; the down
# drops the column, and 0221 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0221 edition scope and its down migration on aw_0221"
migrate_until aw_0221 0221_edition_applies_when
check_in aw_0221 "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'knowledge_edition_revisions_applies_when_object'" "CHECK (((applies_when IS NULL) OR (jsonb_typeof(applies_when) = 'object'::text)))" "0221: a scope is a JSON object or absent"
apply_in aw_0221 0221_edition_applies_when.down.sql
check_in aw_0221 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_edition_revisions' AND column_name = 'applies_when'" "0" "0221 down drops the column"
apply_in aw_0221 0221_edition_applies_when.sql
check_in aw_0221 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_edition_revisions' AND column_name = 'applies_when'" "1" "0221 applies again after its down"
echo "==> 0221 edition scope and its down migration verified"

# 0223: `deletion_queue.status` holds one of the five values of
# `DELETION_STATUSES` (ADR-0179), added NOT VALID: a row from before it is not
# read and not rewritten, every insert and every later update is checked, and
# the down removes the constraint. `deletion-queue-status-check.spec.ts` holds
# the list below, the migration's SQL and the schema's CHECK to the tuple.
# ---------------------------------------------------------------------------
echo "==> verifying 0223 deletion queue status and its down migration on dq_0223"
migrate_before dq_0223 0223_deletion_queue_status_known
DQ_ROW="'folder', 'f-0223', 'Ordner', 'org_0223', 'user_0223', now()"
sql_in dq_0223 <<SQL
INSERT INTO deletion_queue (entity_type, entity_id, display_name, organization_id, requested_by, purge_after, status)
  VALUES ('folder', 'f-0223-old', 'Ordner', 'org_0223', 'user_0223', now(), 'paused');
SQL
apply_in dq_0223 0223_deletion_queue_status_known.sql
check_in dq_0223 "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'deletion_queue_status_known'" "CHECK ((status = ANY (ARRAY['pending'::text, 'purging'::text, 'purged'::text, 'restored'::text, 'failed'::text]))) NOT VALID" "0223: the status is one of the five declared values"
check_in dq_0223 "SELECT status FROM deletion_queue WHERE entity_id = 'f-0223-old'" "paused" "0223 leaves a row from before it as it was"
refused_in dq_0223 "INSERT INTO deletion_queue (entity_type, entity_id, display_name, organization_id, requested_by, purge_after, status) VALUES ($DQ_ROW, 'paused')" "deletion_queue_status_known" "an unknown status inserted"
refused_in dq_0223 "UPDATE deletion_queue SET status = 'done' WHERE entity_id = 'f-0223-old'" "deletion_queue_status_known" "an old row moved to another unknown status"
sql_in dq_0223 <<SQL
INSERT INTO deletion_queue (entity_type, entity_id, display_name, organization_id, requested_by, purge_after) VALUES ($DQ_ROW);
UPDATE deletion_queue SET status = 'purging' WHERE entity_id = 'f-0223';
UPDATE deletion_queue SET status = 'purged' WHERE entity_id = 'f-0223';
UPDATE deletion_queue SET status = 'pending' WHERE entity_id = 'f-0223-old';
SQL
check_in dq_0223 "SELECT string_agg(status, ',' ORDER BY entity_id) FROM deletion_queue" "purged,pending" "0223 takes every declared status, the default included"
apply_in dq_0223 0223_deletion_queue_status_known.down.sql
check_in dq_0223 "SELECT count(*) FROM pg_constraint WHERE conname = 'deletion_queue_status_known'" "0" "0223 down removes the constraint"
sql_in dq_0223 <<SQL
UPDATE deletion_queue SET status = 'paused' WHERE entity_id = 'f-0223-old';
SQL
apply_in dq_0223 0223_deletion_queue_status_known.sql
check_in dq_0223 "SELECT convalidated::text FROM pg_constraint WHERE conname = 'deletion_queue_status_known'" "false" "0223 applies again after its down, over a row it would refuse"
echo "==> 0223 deletion queue status and its down migration verified"

# ---------------------------------------------------------------------------
# 0224: four eyes on what nobody fetched from a reviewed source (ADR-0165). A
# manifestation whose text a person uploaded, or that only names a corpus file,
# holds every approval up until somebody other than its author and its uploader
# checked it against its source. So does a text or a capture fetched through a
# source its own draft proposes: only a built-in source, or a source record's
# revision released by two people, counts (the release itself is exercised in
# texts.integration.spec.ts, through the service). A capture stored before the
# column counts only when no record ever configured its source. The down gives
# 0218's check back, and 0224 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0224 text four eyes and its down migration on tf_0224"
migrate_before tf_0224 0224_knowledge_text_four_eyes
CR_UP="c0000000-0000-4000-8000-000000000224"
CR_URL="c1000000-0000-4000-8000-000000000224"
CR_OWN="c2000000-0000-4000-8000-000000000224"
CR_OLD="c3000000-0000-4000-8000-000000000224"
CR_OLD_OWN="c4000000-0000-4000-8000-000000000224"
CR_NEW="c5000000-0000-4000-8000-000000000224"
RV_UP="e0000000-0000-4000-8000-000000000224"
RV_URL="e1000000-0000-4000-8000-000000000224"
RV_OWN="e2000000-0000-4000-8000-000000000224"
RV_SRC="e3000000-0000-4000-8000-000000000224"
RV_OLD="e4000000-0000-4000-8000-000000000224"
RV_OLD_OWN="e5000000-0000-4000-8000-000000000224"
CAP_OLD="a0000000-0000-4000-8000-000000000224"
CAP_OLD_OWN="a1000000-0000-4000-8000-000000000224"
sql_in tf_0224 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES
  ('$CR_UP', 'an uploaded text', 'XA', 'user_author'), ('$CR_URL', 'a text fetched from a built-in source', 'XA', 'user_author'),
  ('$CR_OWN', 'a text fetched through the draft''s own source', 'XA', 'user_author'),
  ('$CR_OLD', 'an old capture from a built-in source', 'XA', 'user_author'),
  ('$CR_OLD_OWN', 'an old capture through a source record', 'XA', 'user_author'), ('$CR_NEW', 'captures after 0224', 'XA', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES
  ('edition:xa-1', NULL, 'edition', 'XA', 'user_author'), ('source:xa-own', NULL, 'source', 'XA', 'user_author'),
  ('work:xa-old', NULL, 'work', 'XA', 'user_author'), ('work:xa-old-own', NULL, 'work', 'XA', 'user_author'),
  ('manifestation:xa-up', NULL, 'manifestation', 'XA', 'user_author'), ('manifestation:xa-url', NULL, 'manifestation', 'XA', 'user_author'),
  ('manifestation:xa-own', NULL, 'manifestation', 'XA', 'user_author');
INSERT INTO knowledge_citation_captures (id, change_request_id, basis, source_id, url, sha256, byte_size, retrieved_at, created_by) VALUES
  ('$CAP_OLD', '$CR_OLD', 'fetched', 'xa-ris', 'https://ris.example/1', repeat('a', 64), 1, now(), 'user_author'),
  ('$CAP_OLD_OWN', '$CR_OLD_OWN', 'fetched', 'xa-own', 'https://attacker.example/1', repeat('b', 64), 1, now(), 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id, provenance) VALUES
  ('$RV_UP', 'manifestation:xa-up', 'manifestation', NULL, 'user_author', '$CR_UP',
   '{"text": {"origin": "upload", "fileName": "xa-up.pdf", "sha256": "aa", "attachedBy": "user_uploader"}}'),
  ('$RV_URL', 'manifestation:xa-url', 'manifestation', NULL, 'user_author', '$CR_URL',
   '{"text": {"origin": "url", "fileName": "xa-url.pdf", "sha256": "bb", "sourceId": "xa-ris", "sourceOrigin": "built_in", "attachedBy": "user_author"}}'),
  ('$RV_SRC', 'source:xa-own', 'source', NULL, 'user_author', '$CR_OWN', '{}'),
  ('$RV_OWN', 'manifestation:xa-own', 'manifestation', NULL, 'user_author', '$CR_OWN',
   '{"text": {"origin": "url", "fileName": "xa-own.pdf", "sha256": "cc", "sourceId": "xa-own", "sourceOrigin": "draft", "sourceRevisionId": "$RV_SRC", "attachedBy": "user_author"}}'),
  ('$RV_OLD', 'work:xa-old', 'work', NULL, 'user_author', '$CR_OLD', '{"citations": [{"captureId": "$CAP_OLD"}]}'),
  ('$RV_OLD_OWN', 'work:xa-old-own', 'work', NULL, 'user_author', '$CR_OLD_OWN', '{"citations": [{"captureId": "$CAP_OLD_OWN"}]}');
INSERT INTO knowledge_manifestation_revisions (revision_id, record_id, organization_id, edition_id, licence_class, corpus_file, sha256) VALUES
  ('$RV_UP', 'manifestation:xa-up', NULL, 'edition:xa-1', 'public_open', 'xa-up.pdf', 'aa'),
  ('$RV_URL', 'manifestation:xa-url', NULL, 'edition:xa-1', 'public_open', 'xa-url.pdf', 'bb'),
  ('$RV_OWN', 'manifestation:xa-own', NULL, 'edition:xa-1', 'public_open', 'xa-own.pdf', 'cc');
UPDATE knowledge_change_requests SET status = 'submitted' WHERE id IN ('$CR_UP', '$CR_URL', '$CR_OWN', '$CR_OLD', '$CR_OLD_OWN');
SQL
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_UP')::text" "false" "before 0224 an uploaded text holds no approval up"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_OLD_OWN')::text" "false" "before 0224 a capture fetched through any source holds no approval up"
apply_in tf_0224 0224_knowledge_text_four_eyes.sql
apply_in tf_0224 0224_knowledge_text_four_eyes.sql   # up twice: idempotent
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_UP')::text" "true" "0224: an uploaded text nobody else checked is unchecked"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_URL')::text" "false" "0224: a text fetched from a built-in source counts as fetched"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_OWN')::text" "true" "0224: a text fetched through a source its own draft proposes is unchecked"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_OLD')::text" "false" "0224: a capture stored before it, from a source no record configures, counts as fetched"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_OLD_OWN')::text" "true" "0224: a capture stored before it, through a source a record configures, is unchecked"
check_in tf_0224 "SELECT knowledge_source_reviewed('xa-own', 'released', '$RV_SRC', now())::text" "false" "0224: a revision no release published is no released source, whatever the fetch recorded"
refused_in tf_0224 "INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source, override_reason) VALUES (gen_random_uuid(), '$CR_UP', 'user_author', 'domain_expert', 'app', 'urgent')" "no reviewer checked" "an approval alone over an uploaded text nobody else checked"
refused_in tf_0224 "INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source, override_reason) VALUES (gen_random_uuid(), '$CR_OWN', 'user_author', 'domain_expert', 'app', 'urgent')" "no reviewer checked" "an approval alone over a text fetched through the author's own source"
# An older build, during a rollout or after a rollback, still writes a fetched capture without an origin: accepted,
# and held like the ones stored before when a record configures its source.
sql_in tf_0224 <<SQL
INSERT INTO knowledge_citation_captures (id, change_request_id, basis, source_id, url, sha256, byte_size, retrieved_at, created_by) VALUES
  ('a2000000-0000-4000-8000-000000000224', '$CR_NEW', 'fetched', 'xa-own', 'https://attacker.example/2', repeat('c', 64), 1, now(), 'user_author');
SQL
check_in tf_0224 "SELECT knowledge_capture_counts_as_fetched(basis, source_id, source_origin, source_revision_id, created_at)::text FROM knowledge_citation_captures WHERE id = 'a2000000-0000-4000-8000-000000000224'" "false" "0224: an older build's capture through a source a record configures does not count"
refused_in tf_0224 "INSERT INTO knowledge_citation_captures (id, change_request_id, basis, source_id, source_origin, url, sha256, byte_size, retrieved_at, created_by) VALUES (gen_random_uuid(), '$CR_NEW', 'fetched', 'xa-own', 'draft', 'https://attacker.example/2', repeat('c', 64), 1, now(), 'user_author')" "knowledge_citation_captures_source_revision_named" "a capture through a source record that names no revision"
refused_in tf_0224 "INSERT INTO knowledge_citation_captures (id, change_request_id, basis, source_origin, url, sha256, byte_size, retrieved_at, created_by) VALUES (gen_random_uuid(), '$CR_NEW', 'operator_supplied', 'built_in', 'https://ris.example/3', repeat('c', 64), 1, now(), 'user_author')" "knowledge_citation_captures_source_origin_known" "a pasted page that claims a source"
sql_in tf_0224 <<SQL
INSERT INTO knowledge_citation_captures (id, change_request_id, basis, source_id, source_origin, source_revision_id, url, sha256, byte_size, retrieved_at, created_by) VALUES
  (gen_random_uuid(), '$CR_NEW', 'fetched', 'xa-ris', 'built_in', NULL, 'https://ris.example/4', repeat('d', 64), 1, now(), 'user_author'),
  (gen_random_uuid(), '$CR_NEW', 'fetched', 'xa-own', 'draft', '$RV_SRC', 'https://attacker.example/4', repeat('e', 64), 1, now(), 'user_author');
SQL
check_in tf_0224 "SELECT string_agg(source_origin || '=' || knowledge_capture_counts_as_fetched(basis, source_id, source_origin, source_revision_id, created_at)::text, ',' ORDER BY source_origin) FROM knowledge_citation_captures WHERE change_request_id = '$CR_NEW' AND source_origin IS NOT NULL" "built_in=true,draft=false" "0224: a capture through a built-in source counts, one through a draft's source does not"
sql_in tf_0224 <<SQL
INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, source_checked, decision_source)
  VALUES (gen_random_uuid(), '$CR_UP', '$RV_UP', 'corpusFile', 'accepted', 'user_uploader', true, 'app');
SQL
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_UP')::text" "true" "0224: the uploader's own source check does not count"
sql_in tf_0224 <<SQL
INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, source_checked, decision_source)
  VALUES (gen_random_uuid(), '$CR_UP', '$RV_UP', 'corpusFile', 'accepted', 'user_expert', true, 'app'),
         (gen_random_uuid(), '$CR_OWN', '$RV_OWN', 'corpusFile', 'accepted', 'user_expert', true, 'app');
SQL
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_UP')::text" "false" "0224: another person's source check clears the uploaded text"
check_in tf_0224 "SELECT knowledge_sources_unchecked('$CR_OWN')::text" "false" "0224: another person's source check clears the text fetched through the draft's source"
apply_in tf_0224 0224_knowledge_text_four_eyes.down.sql
check_in tf_0224 "SELECT (pg_get_functiondef('knowledge_sources_unchecked(uuid)'::regprocedure) LIKE '%knowledge_manifestation_revisions%')::text" "false" "0224 down gives 0218's source check back"
check_in tf_0224 "SELECT count(*) FROM information_schema.columns WHERE table_name = 'knowledge_citation_captures' AND column_name IN ('source_origin', 'source_revision_id')" "0" "0224 down drops the two columns"
check_in tf_0224 "SELECT count(*) FROM pg_proc WHERE proname IN ('knowledge_source_reviewed', 'knowledge_capture_counts_as_fetched', 'knowledge_text_counts_as_fetched')" "0" "0224 down drops its three functions"
apply_in tf_0224 0224_knowledge_text_four_eyes.sql
check_in tf_0224 "SELECT (pg_get_functiondef('knowledge_sources_unchecked(uuid)'::regprocedure) LIKE '%knowledge_text_counts_as_fetched%')::text" "true" "0224 applies again after its down"
echo "==> 0224 text four eyes and its down migration verified"

# ---------------------------------------------------------------------------
# 0226: what the scheduler before 0086 left behind is dropped. `jobs`,
# `job_runs` and `tasks` have no reader since 0086 copied their rows into
# `task_definitions` and `task_runs` under the same ids. The rows below are a
# job with its fire and its task, and the definition and run 0086 made of them:
# 0226 takes the old three and leaves the copies, the conversation's link to
# the definition included. `bff_job_queue` stays, and so does the lane order
# of the retired claim (`bff_job_lane_turns`) with its row: production's
# running release still claims through it. The down gives the three tables back
# empty, with their policies, checks, foreign keys and the partial due index,
# and 0226 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0226 dead scheduler schema and its down migration on dead_0226"
migrate_before dead_0226 0226_drop_dead_scheduler_schema
TABLES_0226="SELECT count(*) FROM pg_class WHERE relkind = 'r' AND relname IN ('jobs', 'job_runs', 'tasks')"
LANE_0226="SELECT (SELECT count(*) FROM pg_class WHERE relkind = 'r' AND relname = 'bff_job_lane_turns') || ':' || (SELECT count(*) FROM bff_job_lane_turns WHERE lane = 'org_0226')"
COPIES_0226="SELECT (SELECT count(*) FROM task_definitions WHERE id = 'bbbbbbbb-0000-4000-8000-000000000226') || ':' || (SELECT count(*) FROM task_runs WHERE id = 'cccccccc-0000-4000-8000-000000000226') || ':' || (SELECT job_id FROM conversations WHERE id = 's_0226')"
sql_in dead_0226 <<SQL
INSERT INTO bff_job_lane_turns (lane, last_claimed_at) VALUES ('org_0226', now());
INSERT INTO projects (id, organization_id, name, created_by, collection_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000226', 'org_0226', 'Dead 0226', 'user_1', 'proj_0226');
INSERT INTO jobs (id, project_id, organization_id, name, prompt, output, schedule_cron, created_by)
VALUES ('bbbbbbbb-0000-4000-8000-000000000226', 'aaaaaaaa-0000-4000-8000-000000000226', 'org_0226', 'Montags', 'Was ist offen?', 'chat', '0 8 * * 1', 'user_1');
INSERT INTO job_runs (id, schedule_id, project_id, organization_id, job_id, trigger, status, skill_snapshot)
VALUES ('cccccccc-0000-4000-8000-000000000226', 'bbbbbbbb-0000-4000-8000-000000000226', 'aaaaaaaa-0000-4000-8000-000000000226', 'org_0226', 'backend-0226', 'schedule', 'submitted', '{}');
INSERT INTO tasks (organization_id, project_id, kind, title, plan, requester_user_id, status, job_id, job_run_id, backend_job_id)
VALUES ('org_0226', 'aaaaaaaa-0000-4000-8000-000000000226', 'chat', 'Montags', '{"prompt": "Was ist offen?"}', 'user_1', 'succeeded',
  'bbbbbbbb-0000-4000-8000-000000000226', 'cccccccc-0000-4000-8000-000000000226', 'backend-0226');
INSERT INTO task_definitions (id, organization_id, project_id, kind, title, plan, requester_user_id, trigger, schedule_cron)
VALUES ('bbbbbbbb-0000-4000-8000-000000000226', 'org_0226', 'aaaaaaaa-0000-4000-8000-000000000226', 'chat', 'Montags', '{"prompt": "Was ist offen?"}', 'user_1', 'schedule', '0 8 * * 1');
INSERT INTO task_runs (id, organization_id, project_id, definition_id, kind, title, plan, requester_user_id, trigger, status, skill_snapshot, backend_job_id)
VALUES ('cccccccc-0000-4000-8000-000000000226', 'org_0226', 'aaaaaaaa-0000-4000-8000-000000000226', 'bbbbbbbb-0000-4000-8000-000000000226', 'chat', 'Montags',
  '{"prompt": "Was ist offen?"}', 'user_1', 'schedule', 'succeeded', '{}', 'backend-0226');
INSERT INTO conversations (id, organization_id, created_by, project_id, job_id)
VALUES ('s_0226', 'org_0226', 'user_1', 'aaaaaaaa-0000-4000-8000-000000000226', 'bbbbbbbb-0000-4000-8000-000000000226');
SQL
check_in dead_0226 "$TABLES_0226" "3" "before 0226 the three legacy tables exist"
check_in dead_0226 "SELECT count(*) FROM pg_constraint WHERE confrelid IN ('jobs'::regclass, 'job_runs'::regclass, 'tasks'::regclass) AND conrelid NOT IN ('jobs'::regclass, 'job_runs'::regclass, 'tasks'::regclass)" "0" "no other table references the legacy three"
apply_in dead_0226 0226_drop_dead_scheduler_schema.sql
check_in dead_0226 "$TABLES_0226" "0" "0226 drops the three legacy tables"
check_in dead_0226 "$LANE_0226" "1:1" "0226 leaves the lane order production still claims through, and its row"
check_in dead_0226 "SELECT count(*) FROM pg_class WHERE relname IN ('idx_jobs_due', 'uniq_tasks_backend_job_id', 'idx_job_runs_backend_job_id')" "0" "0226 takes their indexes with them"
check_in dead_0226 "SELECT count(*) FROM pg_class WHERE relname IN ('bff_job_queue', 'task_definitions', 'task_runs') AND relkind = 'r'" "3" "0226 leaves bff_job_queue and the task model"
check_in dead_0226 "$COPIES_0226" "1:1:bbbbbbbb-0000-4000-8000-000000000226" "0226 leaves the definition, its run and the conversation's link"
apply_in dead_0226 0226_drop_dead_scheduler_schema.down.sql
check_in dead_0226 "$TABLES_0226" "3" "0226 down gives the three tables back"
check_in dead_0226 "SELECT (SELECT count(*) FROM jobs) + (SELECT count(*) FROM job_runs) + (SELECT count(*) FROM tasks)" "0" "0226 down gives them back empty"
check_in dead_0226 "SELECT string_agg(c.relname || '=' || c.relrowsecurity::text || '/' || (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'), ',' ORDER BY c.relname) FROM pg_class c WHERE c.relkind = 'r' AND c.relname IN ('jobs', 'job_runs', 'tasks')" "job_runs=true/1,jobs=true/1,tasks=true/1" "0226 down secures all three again"
check_in dead_0226 "$LANE_0226" "1:1" "0226 down leaves the lane order and its row alone"
check_in dead_0226 "SELECT string_agg(conrelid::regclass || '.' || conname, ',' ORDER BY conrelid::regclass::text, conname) FROM pg_constraint WHERE conrelid IN ('jobs'::regclass, 'job_runs'::regclass, 'tasks'::regclass) AND contype IN ('c', 'f')" "job_runs.job_runs_conversation_id_organization_id_fkey,job_runs.job_runs_schedule_id_fkey,jobs.jobs_project_id_fkey,jobs.jobs_skill_pair_check,tasks.tasks_filing_status_known,tasks.tasks_job_id_fkey,tasks.tasks_job_run_id_fkey,tasks.tasks_project_id_fkey,tasks.tasks_review_complete,tasks.tasks_review_known,tasks.tasks_status_known" "0226 down gives the checks and foreign keys their names back"
check_in dead_0226 "SELECT (pg_get_indexdef('idx_jobs_due'::regclass) LIKE '%(next_run_at) WHERE ((schedule_cron IS NOT NULL) AND enabled)')::text" "true" "0226 down gives the due index its predicate back"
check_in dead_0226 "SELECT count(*) FROM pg_indexes WHERE tablename IN ('jobs', 'job_runs', 'tasks')" "15" "0226 down gives every index back"
check_in dead_0226 "$COPIES_0226" "1:1:bbbbbbbb-0000-4000-8000-000000000226" "0226 down touches no copy"
apply_in dead_0226 0226_drop_dead_scheduler_schema.sql
check_in dead_0226 "$TABLES_0226" "0" "0226 applies again after its down"
echo "==> 0226 dead scheduler schema and its down migration verified"

# ---------------------------------------------------------------------------
# 0227: a `pending` deletion always has an attempt left (ADR-0179). The purger
# claims a row only below its cap of ten, so a `pending` row at the cap waits
# for ever; the purger used to repair one on every tick (`reofferExhausted`).
# The migration repairs the rows from before it once, as that did, and adds the
# CHECK NOT VALID; a row in any other status keeps its attempts. The down
# removes the constraint, and 0227 applies again over a row stranded meanwhile.
# `deletion-queue.spec.ts` holds the definition below to `DELETION_MAX_ATTEMPTS`.
# ---------------------------------------------------------------------------
echo "==> verifying 0227 pending deletions keep an attempt and its down migration on dq_0227"
migrate_before dq_0227 0227_deletion_queue_pending_has_attempts
DQ_0227="INSERT INTO deletion_queue (entity_type, entity_id, display_name, organization_id, requested_by, purge_after, status, attempts) VALUES ('folder'"
DQ_0227_REST="'Ordner', 'org_0227', 'user_0227', now()"
STATE_0227="SELECT string_agg(entity_id || '=' || status || '/' || attempts, ',' ORDER BY entity_id) FROM deletion_queue"
sql_in dq_0227 <<SQL
$DQ_0227, 'f-a-stranded', $DQ_0227_REST, 'pending', 11);
$DQ_0227, 'f-b-waiting', $DQ_0227_REST, 'pending', 3);
$DQ_0227, 'f-c-failed', $DQ_0227_REST, 'failed', 10);
$DQ_0227, 'f-d-retried', $DQ_0227_REST, 'purging', 11);
SQL
apply_in dq_0227 0227_deletion_queue_pending_has_attempts.sql
check_in dq_0227 "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'deletion_queue_pending_has_attempts'" "CHECK (((status <> 'pending'::text) OR (attempts < 10))) NOT VALID" "0227: a pending row is below the attempt cap"
check_in dq_0227 "$STATE_0227" "f-a-stranded=pending/9,f-b-waiting=pending/3,f-c-failed=failed/10,f-d-retried=purging/11" "0227 gives a stranded row its last attempt back and touches no other"
refused_in dq_0227 "$DQ_0227, 'f-e-new', $DQ_0227_REST, 'pending', 10)" "deletion_queue_pending_has_attempts" "a pending row inserted at the cap"
refused_in dq_0227 "UPDATE deletion_queue SET attempts = attempts + 1 WHERE entity_id = 'f-a-stranded'" "deletion_queue_pending_has_attempts" "a pending row counted up to the cap"
refused_in dq_0227 "UPDATE deletion_queue SET status = 'pending' WHERE entity_id = 'f-d-retried'" "deletion_queue_pending_has_attempts" "a claim at the cap released as pending"
sql_in dq_0227 <<SQL
UPDATE deletion_queue SET status = 'purging', attempts = attempts + 1 WHERE entity_id = 'f-a-stranded';
UPDATE deletion_queue SET status = 'failed' WHERE entity_id IN ('f-a-stranded', 'f-d-retried');
UPDATE deletion_queue SET status = 'pending', attempts = 0 WHERE entity_id = 'f-d-retried';
SQL
check_in dq_0227 "$STATE_0227" "f-a-stranded=failed/10,f-b-waiting=pending/3,f-c-failed=failed/10,f-d-retried=pending/0" "0227 takes the last claim, its failure, and a hand-over that starts the attempts again"
apply_in dq_0227 0227_deletion_queue_pending_has_attempts.down.sql
check_in dq_0227 "SELECT count(*) FROM pg_constraint WHERE conname = 'deletion_queue_pending_has_attempts'" "0" "0227 down removes the constraint"
sql_in dq_0227 <<SQL
UPDATE deletion_queue SET status = 'pending', attempts = 12 WHERE entity_id = 'f-c-failed';
SQL
apply_in dq_0227 0227_deletion_queue_pending_has_attempts.sql
check_in dq_0227 "SELECT status || '/' || attempts FROM deletion_queue WHERE entity_id = 'f-c-failed'" "pending/9" "0227 applies again after its down, repairing a row stranded meanwhile"
echo "==> 0227 pending deletions keep an attempt and its down migration verified"
# 0228: golden cases as records, and golden runs (ADR-0165 amendment). What the
# service does is golden-run.integration.spec.ts (registered above); here, what
# the database itself holds: a golden case is a platform record whose body is
# never rewritten; a run's case is asked before it is settled, a settled one
# has a verdict with its result or a failure and never both, and one
# conversation answers one case. The down drops it all, and 0228 applies again.
# ---------------------------------------------------------------------------
echo "==> verifying 0228 golden cases and its down migration on gc_0228"
migrate_until gc_0228 0228_golden_cases
CR="c0000000-0000-4000-8000-000000000228"
RV="e0000000-0000-4000-8000-000000000228"
RUN_ID="a0000000-0000-4000-8000-000000000228"
ASK="b0000000-0000-4000-8000-000000000228"
sql_in gc_0228 <<SQL
INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES ('$CR', 'XA', 'XA', 'user_author');
INSERT INTO knowledge_records (id, organization_id, type, country_id, created_by) VALUES ('golden_case:xa-stair', NULL, 'golden_case', 'XA', 'user_author');
INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by, change_request_id)
  VALUES ('$RV', 'golden_case:xa-stair', 'golden_case', NULL, 'user_author', '$CR');
INSERT INTO knowledge_golden_case_revisions (revision_id, record_id, organization_id, question, language, context, expected, must_not, tags)
  VALUES ('$RV', 'golden_case:xa-stair', NULL, 'How long may the escape route be?', 'en', '{}', '{"values": []}', '[]', '{fixture}');
INSERT INTO knowledge_golden_runs (id, country_id, asked_in, started_by) VALUES ('$RUN_ID', 'XA', 'org_platform', 'user_author');
INSERT INTO knowledge_golden_run_cases (run_id, record_id, revision_id, position) VALUES ('$RUN_ID', 'golden_case:xa-stair', '$RV', 0);
SQL
refused_in gc_0228 "INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES ('golden_case:office', 'org_a', 'golden_case', 'user_a')" "knowledge_records_platform_types" "an office owning a golden case"
refused_in gc_0228 "UPDATE knowledge_golden_case_revisions SET question = 'Another question?'" "append-only" "a golden case's question rewritten"
refused_in gc_0228 "UPDATE knowledge_golden_run_cases SET ask_id = '$ASK' WHERE run_id = '$RUN_ID'" "knowledge_golden_run_cases_asked" "a case asked with no conversation"
refused_in gc_0228 "UPDATE knowledge_golden_run_cases SET settled_at = now(), passed = true WHERE run_id = '$RUN_ID'" "knowledge_golden_run_cases_settled" "a verdict with no result"
refused_in gc_0228 "UPDATE knowledge_golden_run_cases SET settled_at = now(), passed = false, result = '{}', failure = 'failed: no answer' WHERE run_id = '$RUN_ID'" "knowledge_golden_run_cases_settled" "a verdict and a failure at once"
sql_in gc_0228 <<SQL
UPDATE knowledge_golden_run_cases SET ask_id = '$ASK', conversation_id = 's_golden_0228', asked_at = now() WHERE run_id = '$RUN_ID';
INSERT INTO knowledge_golden_runs (id, country_id, asked_in, started_by) VALUES ('a1000000-0000-4000-8000-000000000228', 'XA', 'org_platform', 'user_author');
SQL
refused_in gc_0228 "INSERT INTO knowledge_golden_run_cases (run_id, record_id, revision_id, position, ask_id, conversation_id, asked_at) VALUES ('a1000000-0000-4000-8000-000000000228', 'golden_case:xa-stair', '$RV', 0, gen_random_uuid(), 's_golden_0228', now())" "knowledge_golden_run_cases_conversation" "a second case in one conversation"
sql_in gc_0228 <<SQL
UPDATE knowledge_golden_run_cases SET settled_at = now(), passed = true, result = '{"checks": []}' WHERE run_id = '$RUN_ID';
SQL
check_in gc_0228 "SELECT count(*) FROM knowledge_golden_run_cases WHERE passed" "1" "0228: a case asked, then settled with its verdict"
apply_in gc_0228 0228_golden_cases.down.sql
check_in gc_0228 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'knowledge_golden_%'" "0" "0228 down drops the golden tables"
check_in gc_0228 "SELECT count(*) FROM knowledge_records WHERE type = 'golden_case'" "0" "0228 down drops the golden cases"
apply_in gc_0228 0228_golden_cases.sql
check_in gc_0228 "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'knowledge_golden_%'" "3" "0228 applies again after its down"
echo "==> 0228 golden cases and its down migration verified"
