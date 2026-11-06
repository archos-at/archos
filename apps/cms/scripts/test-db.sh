#!/usr/bin/env bash
# A throwaway Postgres for the CMS, then a command against it, then nothing left.
#
#   bash scripts/test-db.sh                 # the integration suite (tests/int), migrations first
#   bash scripts/test-db.sh -- <command…>   # any command, with DATABASE_URL set (e.g. `bun run dev`)
#
# The database is owned by a plain role without CREATEDB or CREATEROLE, as
# CloudNativePG hands `cms-pg`'s owner to the CMS, so a migration that needs more
# fails here first. Everything lives in a temporary directory torn down on exit.
set -euo pipefail

CMS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CMS_TEST_PORT:-$(node -e '
  const server = require("net").createServer();
  server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });
')}"
PGBIN="${PGBIN:-$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "error: no PostgreSQL server binaries found. Install postgresql, or set PGBIN." >&2
  exit 1
fi
WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/pgdata"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "error: running as root and no 'postgres' user to drop to." >&2; exit 1; }
  RUNAS=postgres
  mkdir -p "$PGDATA" && chown "$RUNAS" "$WORKDIR" "$PGDATA" && chmod 755 "$WORKDIR"
fi
run_pg() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else sh -c "$1"; fi; }
cleanup() {
  run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

run_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust" >/dev/null
run_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -o '-p $PORT -k $WORKDIR -c listen_addresses=127.0.0.1' -l '$PGDATA/server.log' -w start" >/dev/null
"$PGBIN/psql" -h "$WORKDIR" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE cms LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'cms';" \
  -c "CREATE DATABASE cms OWNER cms;"
export DATABASE_URL="postgresql://cms:cms@127.0.0.1:$PORT/cms" # pragma: allowlist secret (throwaway cluster)
export PAYLOAD_SECRET="${PAYLOAD_SECRET:-throwaway-test-secret}" # pragma: allowlist secret
cd "$CMS_DIR"

if [ "${1:-}" = "--" ]; then
  shift
  echo "==> DATABASE_URL=$DATABASE_URL; running: $*"
  "$@"
  exit 0
fi

echo "==> migrating a fresh database as its owner"
npx --no-install cross-env NODE_OPTIONS=--no-deprecation payload migrate
# A collection or field changed without its migration would reach production as a server
# that cannot start; here it is a red suite. `--skip-empty` writes nothing when there is no drift.
echo "==> the config and the migrations agree"
before="$(ls src/migrations)"
cp src/migrations/index.ts "$WORKDIR/migrations-index.ts"
npx --no-install cross-env NODE_OPTIONS=--no-deprecation payload migrate:create drift --skip-empty </dev/null >/dev/null
if [ "$(ls src/migrations)" != "$before" ]; then
  echo "error: the Payload config differs from src/migrations. Run \`bun run test:db -- payload migrate:create <name>\` locally and commit it." >&2
  rm -f src/migrations/*_drift.ts src/migrations/*_drift.json
  cp "$WORKDIR/migrations-index.ts" src/migrations/index.ts
  exit 1
fi
echo "==> the integration suite"
CMS_TEST_DATABASE_URL="$DATABASE_URL" npx --no-install vitest run --config vitest.int.config.mts
