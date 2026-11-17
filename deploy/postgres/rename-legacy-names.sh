#!/bin/sh
# Give the row-level-security roles names without a brand (ADR-0145 row 10d),
# once the migrations have run (`after-migrate`):
#
#   grid_app_owner    -> app_owner
#   grid_app_platform -> app_platform
#   grid_app_rw       -> app_rw
#   grid_keda_scaler  -> keda_scaler
#
# The migrations written before the rename grant to them by their old names: a
# fresh install creates them under those names (`ensure_rls_roles` here,
# `init-db.sql` in Compose), migrates, and renames. The databases and the
# application role (`aiq_jobs`, `aiq_checkpoints`, `grid_app`, role `aiq`) were
# renamed by this script too, until every deployment had run it (2026-11): a
# fresh install creates them under their new names.
#
# Run on every deploy before the backend starts: the Kubernetes Jobs
# `pg-rename-legacy-names` and `pg-rename-rls-roles`
# (deploy/pulumi/src/data/postgres-rename.ts) and the Compose services
# `postgres-rename` and `postgres-rename-roles`. Idempotent: a role already
# renamed is left alone, so the second run is a no-op.
#
# It connects as a superuser to the maintenance database `postgres`, from the
# libpq environment (PGHOST, PGPORT, PGUSER, PGPASSWORD). ROLE_PASSWORD, when
# set, is the application role's password. RUNTIME_PASSWORD and
# SCALER_PASSWORD, when set, are the runtime and the KEDA scaler role's
# passwords: Kubernetes keeps these roles here rather than in the Cluster's
# `managed.roles`, which would create the new names as new, empty roles before
# the rename ran.
#
# A third mode, `normalize-ownership`, also runs at the end of the default mode:
# every function, table, view, materialized view and sequence in `public` that
# the migration role does not own is handed to it. The migrations run as that
# role (`OWNER_ROLE`, default `agent`) and `ALTER FUNCTION … RENAME`, `ALTER
# TABLE` and `DROP` need ownership, so an object a superuser created (a
# restore, a hand-run script) fails the next migration with `42501 must be owner
# of function …` and the migrate Job crash-loops. Objects an extension owns are
# left alone. Idempotent: owned objects are not touched.
#
# Usage: rename-legacy-names.sh [after-migrate | normalize-ownership]
set -eu
PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
export PGOPTIONS

q() { psql -X -v ON_ERROR_STOP=1 -tAq -d postgres "$@"; }
database_exists() { [ "$(q -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]; }
role_exists() { [ "$(q -c "SELECT 1 FROM pg_roles WHERE rolname = '$1'")" = 1 ]; }

wait_for_server() {
  tries=0
  until pg_isready -q -d postgres; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || { echo "postgres is not reachable" >&2; exit 1; }
    sleep 2
  done
}

# Compose logs in as the superuser it creates, `agent` on a fresh volume and `aiq`
# on one from before this script. Kubernetes logs in as `postgres`, whose
# password the operator sets a moment after superuser access is switched on,
# so a refused login is retried for a while before it fails the run.
log_in() {
  tries=0
  until q -c "SELECT 1" >/dev/null 2>&1; do
    if [ "${PGUSER:-}" = agent ] && (PGUSER=aiq && export PGUSER && q -c "SELECT 1" >/dev/null 2>&1); then
      PGUSER=aiq
      export PGUSER
      return
    fi
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || q -c "SELECT 1"
    sleep 5
  done
}

rename_role() {
  old=$1
  new=$2
  if role_exists "$new" || ! role_exists "$old"; then
    echo "role $new: present or nothing to rename"
    return
  fi
  q -c "ALTER ROLE $old RENAME TO $new"
  echo "role $old -> $new"
}

set_password() {
  role=$1
  password=${2:-${ROLE_PASSWORD:-}}
  [ -n "$password" ] || return 0
  role_exists "$role" || return 0
  echo "ALTER ROLE $role PASSWORD :'password'" | q -v password="$password"
}

# The row-level-security roles, old name then new (ADR-0041, ADR-0145 row 10d).
RLS_ROLES="grid_app_owner:app_owner grid_app_platform:app_platform grid_app_rw:app_rw grid_keda_scaler:keda_scaler"

# Whichever of a role's two names exists, or nothing.
current_name() {
  if role_exists "$2"; then echo "$2"; elif role_exists "$1"; then echo "$1"; fi
}

# Before the migrations: every row-level-security role exists under one of its
# names. One that has neither is a fresh install, created under the OLD name
# the earlier migrations grant to; `after-migrate` renames it. The scaler role
# only where its password is set (Kubernetes). Passwords follow the Secrets.
ensure_rls_roles() {
  for pair in $RLS_ROLES; do
    old=${pair%%:*}
    new=${pair#*:}
    [ -z "$(current_name "$old" "$new")" ] || continue
    case $new in
      app_owner) q -c "CREATE ROLE $old LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE" ;;
      app_platform) q -c "CREATE ROLE $old NOLOGIN BYPASSRLS" ;;
      app_rw) q -c "CREATE ROLE $old LOGIN NOINHERIT NOBYPASSRLS" ;;
      keda_scaler)
        [ -n "${SCALER_PASSWORD:-}" ] || continue
        q -c "CREATE ROLE $old LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT ${SCALER_CONNECTION_LIMIT:-4}"
        ;;
    esac
    echo "role $old: created"
  done
  # The runtime role steps up to the platform role per transaction, by asking.
  q -c "GRANT $(current_name grid_app_platform app_platform) TO $(current_name grid_app_rw app_rw)"
  set_rls_passwords
}

set_rls_passwords() {
  set_password "$(current_name grid_app_rw app_rw)" "${RUNTIME_PASSWORD:-}"
  set_password "$(current_name grid_keda_scaler keda_scaler)" "${SCALER_PASSWORD:-}"
}

rename_rls_roles() {
  for pair in $RLS_ROLES; do
    rename_role "${pair%%:*}" "${pair#*:}"
  done
  set_rls_passwords
}

# Hand every object in `public` of the application database to the migration
# role. The database may not exist yet (a fresh install is created by the
# operator or Compose after this), and the role may not either.
normalize_ownership() {
  owner=${OWNER_ROLE:-agent}
  db=${OWNER_DATABASE:-app}
  if ! database_exists "$db" || ! role_exists "$owner"; then
    echo "ownership: $db or role $owner absent, nothing to normalize"
    return
  fi
  # psql does not substitute :'owner' inside a dollar-quoted body, so the role
  # travels as a session setting.
  psql -X -v ON_ERROR_STOP=1 -tAq -d "$db" -v owner="$owner" <<'SQL'
SELECT set_config('ownership.target', :'owner', false) \gset
DO $do$
DECLARE
  target text := current_setting('ownership.target');
  o record;
BEGIN
  FOR o IN
    SELECT format('ALTER %s %s OWNER TO %I',
             CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                            WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
             c.oid::regclass, target) AS stmt, c.oid::regclass::text AS name, r.rolname AS held_by
      FROM pg_class c
      JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       AND r.rolname <> target
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.deptype IN ('e', 'a')) -- extension member; sequence that follows its column's table
    UNION ALL
    SELECT format('ALTER %s %s OWNER TO %I',
             CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
             p.oid::regprocedure, target), p.oid::regprocedure::text, r.rolname
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.pronamespace = 'public'::regnamespace
       AND r.rolname <> target
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    RAISE WARNING 'ownership: % held by %, now %', o.name, o.held_by, target;
    EXECUTE o.stmt;
  END LOOP;
END
$do$;
SQL
  echo "ownership: $db is owned by $owner"
}

wait_for_server
log_in
if [ "${1:-}" = normalize-ownership ]; then
  normalize_ownership
  exit 0
fi
if [ "${1:-}" = after-migrate ]; then
  rename_rls_roles
  echo "rename of the row-level-security roles: done"
  exit 0
fi
set_password agent
[ -z "${ENSURE_RLS_ROLES:-}" ] || ensure_rls_roles
normalize_ownership
echo "rename of the legacy names: done"
