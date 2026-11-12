#!/usr/bin/env bash
# The workspace, its BFF and the agent backend, running locally with a real
# signed-in session and no Docker and no WorkOS account.
#
#   local-stack.sh up               start everything, migrate the database, wait until healthy
#   local-stack.sh down             stop everything this stack started
#   local-stack.sh status           what runs, on which port
#   local-stack.sh session <user>   print a `wos-session` cookie value for anna or bert
#   local-stack.sh zdr on|off       switch the office's zero data retention (through the API)
#   local-stack.sh model <id>       pick one model for every agent group of the office (through the API)
#   local-stack.sh psql [args]      psql on the app database, as the superuser
#   local-stack.sh copy-ui <dir>    a copy of the UI to run a second stack from (see LOCAL_STACK_UI_DIR)
#   local-stack.sh smoke            the browser check: anna adds a memory note, bert sees none
#
# Postgres 16 (server binaries), Redis, the UI (`next dev` behind server.js) and
# the backend in its two roles (`api`, `chat`), plus fake-workos.mjs, a test
# double of the WorkOS API. Settings and ports: defaults.sh. What it is for,
# what it leaves out and what to do when it breaks:
# docs/contributing/local-stack.md.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR source=defaults.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/defaults.sh"

RUN_DIR="$LOCAL_STACK_DIR/run"
LOG_DIR="$LOCAL_STACK_DIR/logs"
PG_DIR="$LOCAL_STACK_DIR/postgres"   # the cluster and its unix socket
PG_DATA="$PG_DIR/data"
UI_URL="http://localhost:$LOCAL_STACK_UI_PORT"
WORKOS_URL="http://127.0.0.1:$LOCAL_STACK_WORKOS_PORT"
DB_URL_RUNTIME="postgres://app_rw:$LOCAL_STACK_DB_PASSWORD@127.0.0.1:$LOCAL_STACK_PG_PORT/app"
DB_URL_OWNER="postgres://agent@127.0.0.1:$LOCAL_STACK_PG_PORT/app"
REDIS_URL_LOCAL="redis://127.0.0.1:$LOCAL_STACK_REDIS_PORT/0"

say() { printf '==> %s\n' "$*" >&2; }
die() { printf 'local-stack: %s\n' "$*" >&2; exit 1; }

# ── processes ─────────────────────────────────────────────────────────────────

port_taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

pid_of() { cat "$RUN_DIR/$1.pid" 2>/dev/null || true; }

running() {
  local pid
  pid="$(pid_of "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Refuse a port someone else holds. Ours (a pid file whose process lives) is fine.
claim_port() {
  local name=$1 port=$2
  if running "$name"; then return 0; fi
  if port_taken "$port"; then
    die "port $port ($name) is taken by another process. Set LOCAL_STACK_*_PORT (defaults.sh) or stop it."
  fi
}

# start NAME DIR CMD...: in its own session, so `down` can stop the whole tree.
start() {
  local name=$1 dir=$2
  shift 2
  if running "$name"; then
    say "$name already running (pid $(pid_of "$name"))"
    return 0
  fi
  local launcher=()
  if command -v setsid >/dev/null 2>&1; then launcher=(setsid); fi
  (cd "$dir" && exec "${launcher[@]}" "$@") >>"$LOG_DIR/$name.log" 2>&1 </dev/null &
  echo $! >"$RUN_DIR/$name.pid"
  say "$name started (pid $!, log $LOG_DIR/$name.log)"
}

stop() {
  local name=$1 pid _
  pid="$(pid_of "$name")"
  rm -f "$RUN_DIR/$name.pid"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || { say "$name stopped"; return 0; }
    sleep 0.25
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  say "$name killed after 10 s"
}

# wait_http NAME URL SECONDS: until the URL answers 2xx, or the process died.
wait_http() {
  local name=$1 url=$2 limit=$3 _
  for _ in $(seq 1 "$limit"); do
    if curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null; then return 0; fi
    if [ -n "$(pid_of "$name")" ] && ! running "$name"; then
      tail -n 30 "$LOG_DIR/$name.log" >&2 || true
      die "$name exited while starting; its log is above ($LOG_DIR/$name.log)"
    fi
    sleep 1
  done
  tail -n 30 "$LOG_DIR/$name.log" >&2 || true
  die "$name did not answer $url within $limit s ($LOG_DIR/$name.log)"
}

# ── postgres ─────────────────────────────────────────────────────────────────

# initdb and pg_ctl refuse to run as root; a root shell runs them as `postgres`.
as_pg() {
  if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sh -c "$1"; fi
}

psql_super() {
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -qtA -h "$PG_DIR" -p "$LOCAL_STACK_PG_PORT" -U postgres "$@"
}

pg_running() { [ -f "$PG_DATA/PG_VERSION" ] && as_pg "'$PGBIN/pg_ctl' -D '$PG_DATA' status" >/dev/null 2>&1; }

postgres_up() {
  [ -x "$PGBIN/initdb" ] || die "no PostgreSQL server binaries; install postgresql-16 or set PGBIN"
  mkdir -p "$PG_DIR"
  if [ "$(id -u)" = 0 ]; then
    id postgres >/dev/null 2>&1 || die "running as root and there is no 'postgres' user to run the server as"
    chown postgres "$PG_DIR"
    as_pg "test -x '$PG_DIR'" || die "the postgres user cannot reach $PG_DIR; set LOCAL_STACK_DIR outside /root"
  fi
  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    say "initialising a cluster in $PG_DATA"
    as_pg "'$PGBIN/initdb' -D '$PG_DATA' -U postgres --auth=trust" >/dev/null
  fi
  if pg_running; then
    say "postgres already running"
  else
    if port_taken "$LOCAL_STACK_PG_PORT"; then die "port $LOCAL_STACK_PG_PORT (postgres) is taken by another process"; fi
    as_pg "'$PGBIN/pg_ctl' -D '$PG_DATA' -l '$PG_DIR/server.log' -w \
      -o \"-p $LOCAL_STACK_PG_PORT -k '$PG_DIR' -c listen_addresses=127.0.0.1\" start" >/dev/null
    say "postgres started on 127.0.0.1:$LOCAL_STACK_PG_PORT (log $PG_DIR/server.log)"
  fi
}

# The deploy's own steps, in the deploy's order (deploy/compose: postgres-rename,
# migrate, postgres-rename-roles), on every `up`: each is idempotent, and a
# migration added since the last `up` is applied by drizzle-kit like on a deploy.
database_migrate() {
  export PGOPTIONS="-c client_min_messages=warning"
  if [ "$(psql_super -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'agent'")" != 1 ]; then
    psql_super -d postgres -c "CREATE ROLE agent LOGIN SUPERUSER"
  fi
  if [ "$(psql_super -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'app'")" != 1 ]; then
    psql_super -d postgres -c "CREATE DATABASE app OWNER agent"
  fi
  local rename=(env PATH="$PGBIN:$PATH" PGHOST="$PG_DIR" PGPORT="$LOCAL_STACK_PG_PORT" PGUSER=postgres
    RUNTIME_PASSWORD="$LOCAL_STACK_DB_PASSWORD" sh "$REPO_ROOT/deploy/postgres/rename-legacy-names.sh")
  say "database: roles (deploy/postgres/rename-legacy-names.sh)"
  ENSURE_RLS_ROLES=1 "${rename[@]}" >>"$LOG_DIR/migrate.log" 2>&1
  say "database: migrations (drizzle-kit migrate, as the deploy runs it)"
  (cd "$LOCAL_STACK_UI_DIR" && APP_MIGRATION_DATABASE_URL="$DB_URL_OWNER" \
    node node_modules/drizzle-kit/bin.cjs migrate) >>"$LOG_DIR/migrate.log" 2>&1 ||
    { tail -n 20 "$LOG_DIR/migrate.log" >&2; die "migration failed ($LOG_DIR/migrate.log)"; }
  "${rename[@]}" after-migrate >>"$LOG_DIR/migrate.log" 2>&1
}

# ── the other processes ──────────────────────────────────────────────────────

redis_up() {
  command -v redis-server >/dev/null 2>&1 || die "redis-server is not installed (it stands in for Dragonfly)"
  claim_port redis "$LOCAL_STACK_REDIS_PORT"
  mkdir -p "$LOCAL_STACK_DIR/redis"
  start redis "$LOCAL_STACK_DIR/redis" redis-server --port "$LOCAL_STACK_REDIS_PORT" --bind 127.0.0.1 \
    --dir "$LOCAL_STACK_DIR/redis" --save "" --appendonly no
}

# The environment of fake-workos.mjs, for `start` and for `session`.
WORKOS_ENV=(env LOCAL_STACK_DIR="$LOCAL_STACK_DIR" LOCAL_STACK_UI_DIR="$LOCAL_STACK_UI_DIR"
  LOCAL_STACK_WORKOS_PORT="$LOCAL_STACK_WORKOS_PORT" WORKOS_CLIENT_ID="$LOCAL_STACK_CLIENT_ID"
  WORKOS_COOKIE_PASSWORD="$LOCAL_STACK_COOKIE_PASSWORD")

workos_up() {
  claim_port workos "$LOCAL_STACK_WORKOS_PORT"
  start workos "$STACK_SCRIPTS" "${WORKOS_ENV[@]}" node fake-workos.mjs serve
}

backend_up() {
  local role=$1 port=$2
  claim_port "$role" "$port"
  mkdir -p "$LOCAL_STACK_DIR/backend"
  local data="$LOCAL_STACK_DIR/backend"
  # The SQLite stores default to the working directory, the repository root.
  start "$role" "$REPO_ROOT" env PROCESS_ROLE="$role" APP_ENV=development LOG_LEVEL=INFO PYTHONWARNINGS=ignore \
    DEV_ENV=cli PYTHONPATH="$REPO_ROOT/packages/agent/src" REQUIRE_AUTH=false \
    FRONTEND_INTERNAL_URL="http://127.0.0.1:$LOCAL_STACK_UI_PORT" INTERNAL_API_TOKEN="$LOCAL_STACK_INTERNAL_TOKEN" \
    REDIS_URL="$REDIS_URL_LOCAL" OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-${OPENROUTER_KEY:-}}" \
    CHECKPOINT_DB="$data/checkpoints.db" NAT_JOB_STORE_DB_URL="sqlite+aiosqlite:///$data/jobs.db" \
    SUMMARY_DB="sqlite+aiosqlite:///$data/summaries.db" \
    "$REPO_ROOT/.venv/bin/nat" serve --config_file "$LOCAL_STACK_BACKEND_CONFIG" --host 127.0.0.1 --port "$port"
}

# Next allows one `next dev` per directory; say whose it is instead of its error.
next_lock_free() {
  local lock="$LOCAL_STACK_UI_DIR/.next/dev/lock" pid
  [ -f "$lock" ] || return 0
  pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$lock")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ "$pid" != "$(pid_of next)" ]; then
    die "a next dev (pid $pid) already runs in $LOCAL_STACK_UI_DIR. Stop it, or run this stack from a copy: $0 copy-ui <dir>, then LOCAL_STACK_UI_DIR=<dir>"
  fi
}

# The UI's environment: a real AuthKit session against fake-workos.mjs.
UI_ENV=(env APP_ENV=development NEXT_TELEMETRY_DISABLED=1 REQUIRE_AUTH=true
  APP_DATABASE_URL="$DB_URL_RUNTIME" REDIS_URL="$REDIS_URL_LOCAL"
  BACKEND_URL="http://127.0.0.1:$LOCAL_STACK_API_PORT" BACKEND_CHAT_URL="http://127.0.0.1:$LOCAL_STACK_CHAT_PORT"
  INTERNAL_API_TOKEN="$LOCAL_STACK_INTERNAL_TOKEN"
  WORKOS_CLIENT_ID="$LOCAL_STACK_CLIENT_ID" WORKOS_API_KEY=sk_test_local_stack
  WORKOS_COOKIE_PASSWORD="$LOCAL_STACK_COOKIE_PASSWORD"
  NEXT_PUBLIC_WORKOS_REDIRECT_URI="$UI_URL/api/auth/callback" WORKOS_REDIRECT_URI="$UI_URL/api/auth/callback"
  WORKOS_API_HOSTNAME=127.0.0.1 WORKOS_API_HTTPS=false WORKOS_API_PORT="$LOCAL_STACK_WORKOS_PORT"
  LOCAL_STACK_WORKOS_ORIGIN="$WORKOS_URL" NODE_OPTIONS="${NODE_OPTIONS:-} --require $STACK_SCRIPTS/workos-redirect.cjs"
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-${OPENROUTER_KEY:-}}")

ui_up() {
  claim_port next "$LOCAL_STACK_NEXT_PORT"
  claim_port gateway "$LOCAL_STACK_UI_PORT"
  if ! running next; then
    next_lock_free
    # What `bun run dev:next` does before it starts, without its fixed port.
    say "ui: staging pdf.js, Excalidraw and MCP app assets"
    (cd "$LOCAL_STACK_UI_DIR" && node scripts/copy-pdfjs-assets.mjs && node scripts/copy-excalidraw-assets.mjs &&
      bun run build:mcp-apps) >>"$LOG_DIR/next.log" 2>&1
  fi
  start next "$LOCAL_STACK_UI_DIR" "${UI_ENV[@]}" node node_modules/next/dist/bin/next dev --turbopack \
    -H 127.0.0.1 -p "$LOCAL_STACK_NEXT_PORT"
  start gateway "$LOCAL_STACK_UI_DIR" "${UI_ENV[@]}" PORT="$LOCAL_STACK_UI_PORT" HOSTNAME=127.0.0.1 \
    NEXT_INTERNAL_URL="http://127.0.0.1:$LOCAL_STACK_NEXT_PORT" node server.js
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_up() {
  [ -x "$REPO_ROOT/.venv/bin/nat" ] || die "no backend venv; run \`task setup\` first"
  [ -d "$LOCAL_STACK_UI_DIR/node_modules" ] || die "no node_modules in $LOCAL_STACK_UI_DIR; run \`task setup\` first"
  mkdir -p "$RUN_DIR" "$LOG_DIR"
  # Every port first, so a clash stops `up` before anything has started.
  pg_running || ! port_taken "$LOCAL_STACK_PG_PORT" || die "port $LOCAL_STACK_PG_PORT (postgres) is taken by another process"
  claim_port redis "$LOCAL_STACK_REDIS_PORT"
  claim_port workos "$LOCAL_STACK_WORKOS_PORT"
  claim_port api "$LOCAL_STACK_API_PORT"
  claim_port chat "$LOCAL_STACK_CHAT_PORT"
  claim_port next "$LOCAL_STACK_NEXT_PORT"
  claim_port gateway "$LOCAL_STACK_UI_PORT"
  running next || next_lock_free
  local started=$SECONDS
  postgres_up
  database_migrate
  redis_up
  workos_up
  wait_http workos "$WORKOS_URL/sso/jwks/$LOCAL_STACK_CLIENT_ID" 30
  backend_up api "$LOCAL_STACK_API_PORT"
  backend_up chat "$LOCAL_STACK_CHAT_PORT"
  # The UI writes the platform model defaults on its first boot, and only when
  # it can read the backend's config then: the backend comes first.
  wait_http api "http://127.0.0.1:$LOCAL_STACK_API_PORT/health" 240
  wait_http chat "http://127.0.0.1:$LOCAL_STACK_CHAT_PORT/health" 240
  ui_up
  wait_http gateway "http://127.0.0.1:$LOCAL_STACK_UI_PORT/api/health" 300
  say "up in $((SECONDS - started)) s. Open $UI_URL with a session cookie: $0 session anna"
  [ -n "${OPENROUTER_API_KEY:-${OPENROUTER_KEY:-}}" ] || say "no OPENROUTER_API_KEY: pages work, chat turns will not"
}

cmd_down() {
  local name
  for name in gateway next chat api workos redis; do stop "$name"; done
  if [ -x "$PGBIN/pg_ctl" ] && pg_running; then
    as_pg "'$PGBIN/pg_ctl' -D '$PG_DATA' -m fast -w stop" >/dev/null
    say "postgres stopped"
  fi
}

cmd_status() {
  local name port state
  printf '%-9s %-6s %-8s %s\n' component port state pid
  if pg_running; then state=up; else state=down; fi
  printf '%-9s %-6s %-8s %s\n' postgres "$LOCAL_STACK_PG_PORT" "$state" "$(head -1 "$PG_DATA/postmaster.pid" 2>/dev/null || true)"
  for name in redis workos api chat next gateway; do
    case $name in
      redis) port=$LOCAL_STACK_REDIS_PORT ;; workos) port=$LOCAL_STACK_WORKOS_PORT ;;
      api) port=$LOCAL_STACK_API_PORT ;; chat) port=$LOCAL_STACK_CHAT_PORT ;;
      next) port=$LOCAL_STACK_NEXT_PORT ;; gateway) port=$LOCAL_STACK_UI_PORT ;;
    esac
    if running "$name"; then state=up; elif port_taken "$port"; then state=foreign; else state=down; fi
    printf '%-9s %-6s %-8s %s\n' "$name" "$port" "$state" "$(pid_of "$name")"
  done
  printf '\ndata %s\nlogs %s\nopen %s\n' "$LOCAL_STACK_DIR" "$LOG_DIR" "$UI_URL"
}

cmd_session() {
  "${WORKOS_ENV[@]}" node "$STACK_SCRIPTS/fake-workos.mjs" mint "${1:-anna}"
}

# api_put PATH JSON: as anna, the office's admin.
api_put() {
  local cookie
  cookie="$(cmd_session anna)"
  curl -sS -X PUT "http://127.0.0.1:$LOCAL_STACK_UI_PORT$1" -H 'content-type: application/json' \
    -H "cookie: wos-session=$cookie" --data "$2" -w '\nHTTP %{http_code}\n'
}

cmd_zdr() {
  case "${1:-}" in
    on) api_put /api/organization/model-config/zdr '{"enabled":true}' ;;
    off) api_put /api/organization/model-config/zdr '{"enabled":false}' ;;
    *) die "usage: $0 zdr on|off" ;;
  esac
}

cmd_model() {
  local model=${1:-} groups group body=''
  [ -n "$model" ] || die "usage: $0 model <openrouter model id>"
  groups="clarifier shallow_research deep_research deep_research_router memory_reflection follow_ups"
  for group in $groups; do body="$body${body:+,}\"$group\":{\"model\":\"$model\"}"; done
  api_put /api/organization/model-config "{\"overrides\":{$body},\"comment\":\"local stack\"}"
}

# Always from this checkout's apps/workspace, whatever LOCAL_STACK_UI_DIR says:
# that variable usually already names the copy about to be made.
cmd_copy_ui() {
  local target=${1:-} source="$REPO_ROOT/apps/workspace"
  [ -n "$target" ] || die "usage: $0 copy-ui <dir>"
  [ ! -e "$target" ] || die "$target exists; pick a new directory"
  [ -d "$source/node_modules" ] || die "no node_modules in $source; run \`task setup\` first"
  mkdir -p "$target"
  say "copying $source to $target (sources copied, node_modules hard-linked)"
  tar -C "$source" --exclude=./node_modules --exclude=./.next -cf - . | tar -C "$target" -xf -
  cp -al "$source/node_modules" "$target/node_modules"
  say "done. Never run an install in either copy while they share node_modules. Use: LOCAL_STACK_UI_DIR=$target"
}

cmd_smoke() {
  env LOCAL_STACK_UI_ORIGIN="$UI_URL" LOCAL_STACK_COOKIE_ANNA="$(cmd_session anna)" \
    LOCAL_STACK_COOKIE_BERT="$(cmd_session bert)" node "$STACK_SCRIPTS/smoke-memory.cjs"
}

command=${1:-}
shift || true
case "$command" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  session) cmd_session "$@" ;;
  zdr) cmd_zdr "$@" ;;
  model) cmd_model "$@" ;;
  psql) exec "$PGBIN/psql" -h "$PG_DIR" -p "$LOCAL_STACK_PG_PORT" -U postgres -d app "$@" ;;
  copy-ui) cmd_copy_ui "$@" ;;
  smoke) cmd_smoke ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac
