# shellcheck shell=bash disable=SC2034  # read by local-stack.sh, which sources this file
# Settings of the local stack, sourced by local-stack.sh. Every one can be set
# in the environment first; the defaults are what `task local:up` uses.
#
# Docs: docs/contributing/local-stack.md.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_SCRIPTS="$REPO_ROOT/scripts/local-stack"

# Where everything the stack writes lives: the database cluster, Redis, the
# backend's SQLite stores, the signing key, the logs, the pid files. Outside
# the repository on purpose. As root the database server runs as the
# `postgres` user, which cannot enter /root, so root gets /var/tmp.
if [ "$(id -u)" = 0 ]; then
  _default_dir=/var/tmp/local-stack
else
  _default_dir="${XDG_STATE_HOME:-$HOME/.local/state}/local-stack"
fi
LOCAL_STACK_DIR="${LOCAL_STACK_DIR:-$_default_dir}"
unset _default_dir

# One port per process. Two stacks on one machine need two sets of ports and
# two data directories (and two UI directories, see LOCAL_STACK_UI_DIR).
LOCAL_STACK_PG_PORT="${LOCAL_STACK_PG_PORT:-55432}"
LOCAL_STACK_REDIS_PORT="${LOCAL_STACK_REDIS_PORT:-56379}"
LOCAL_STACK_WORKOS_PORT="${LOCAL_STACK_WORKOS_PORT:-4010}"
LOCAL_STACK_UI_PORT="${LOCAL_STACK_UI_PORT:-3000}"     # the gateway (server.js): what the browser opens
LOCAL_STACK_NEXT_PORT="${LOCAL_STACK_NEXT_PORT:-3001}" # `next dev` behind the gateway
LOCAL_STACK_API_PORT="${LOCAL_STACK_API_PORT:-8000}"   # backend, PROCESS_ROLE=api
LOCAL_STACK_CHAT_PORT="${LOCAL_STACK_CHAT_PORT:-8001}" # backend, PROCESS_ROLE=chat

# The UI checkout `next dev` runs in. Next allows one `next dev` per directory
# (`.next/dev/lock`), so a second stack beside a running one needs a copy:
# `local-stack.sh copy-ui <dir>`.
LOCAL_STACK_UI_DIR="${LOCAL_STACK_UI_DIR:-$REPO_ROOT/apps/workspace}"
LOCAL_STACK_BACKEND_CONFIG="${LOCAL_STACK_BACKEND_CONFIG:-configs/config_oib_openrouter.yml}"

# PostgreSQL server binaries: the newest under /usr/lib/postgresql, as
# scripts/rls-test-db.sh finds them, or PGBIN.
PGBIN="${PGBIN:-$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1 || true)}"

# Fixed local secrets. They protect nothing: everything binds to 127.0.0.1.
LOCAL_STACK_DB_PASSWORD="local-stack-runtime" # pragma: allowlist secret
LOCAL_STACK_COOKIE_PASSWORD="local-stack-cookie-password-0123456789" # pragma: allowlist secret
LOCAL_STACK_INTERNAL_TOKEN="local-stack-internal-token" # pragma: allowlist secret
LOCAL_STACK_CLIENT_ID="client_local_stack"
