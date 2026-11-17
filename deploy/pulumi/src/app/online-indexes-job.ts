import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { onNodeGroup } from "../platform/scheduling";
import { DeployConfig } from "../config";
import { commonLabels } from "../platform/namespaces";
import { hardenedJobSecurityContext } from "../platform/security";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS } from "../constants";
import { AppSecrets, AppWiring } from "./config";
import { migrationEnv } from "./job-env";

/**
 * An index a pending migration would otherwise build under ACCESS EXCLUSIVE,
 * built online (`CREATE INDEX CONCURRENTLY`) before the migration Job runs.
 *
 * `drizzle-kit migrate` applies every pending migration in one transaction, so a
 * lock one of them takes is held until the last one commits, and `CONCURRENTLY`
 * cannot run inside it. A migration that wants a large index therefore adopts a
 * pre-built one by name (`ADD CONSTRAINT … USING INDEX`, or a plain
 * `CREATE INDEX IF NOT EXISTS` that finds it there), and lists it here so every
 * deploy builds it first. The migration must still build it itself when it is
 * missing: a fresh database has no table yet, and this Job then does nothing.
 *
 * Add an entry only for a table and columns that exist BEFORE the deploy's
 * migrations run. A missing table or column is skipped, not an error, so an
 * entry whose columns a later migration adds simply never builds online.
 */
export interface OnlineIndex {
  /** The migration that adopts the index, for the log and the reader. */
  migration: string;
  /** Table in `public`. */
  table: string;
  /** The index name the migration adopts; for a constraint, also the constraint's name. */
  name: string;
  columns: readonly string[];
  unique: boolean;
}

export const ONLINE_INDEXES: readonly OnlineIndex[] = [
  {
    // 0196 adds `UNIQUE (id, project_id)` and adopts a valid index of this name
    // (`ADD CONSTRAINT … UNIQUE USING INDEX`); docs/deployment/kubernetes.md §3c.
    migration: "0196",
    table: "document_versions",
    name: "document_versions_id_project_id_key",
    columns: ["id", "project_id"],
    unique: true,
  },
];

/**
 * Session settings of every statement the Job runs. No statement timeout: a
 * build on a large table takes as long as it takes, and blocks no reader or
 * writer while it does. A short lock timeout: `CONCURRENTLY` waits for every
 * transaction older than it; behind a long one it fails, leaves an INVALID
 * index, and the Job's next attempt drops it and builds again.
 */
export const ONLINE_INDEX_SESSION = "-c statement_timeout=0 -c lock_timeout=30s";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function checked(id: string): string {
  if (!IDENTIFIER.test(id)) throw new Error(`online index: '${id}' is not a plain lower-case SQL identifier`);
  return id;
}

/**
 * The state of one index as one word: `no-table`, `no-columns`, `constraint`
 * (the migration already ran), `valid`, `invalid` (an interrupted build, or an
 * index of that name that is not what the entry asks for) or `missing`.
 * `to_regclass` throughout, never a `'…'::regclass` literal: the planner folds a
 * literal cast before the CASE picks a branch, and a missing table would error.
 */
function stateQuery(ix: OnlineIndex): string {
  const table = `to_regclass('public.${ix.table}')`;
  const index = `to_regclass('public.${ix.name}')`;
  const columns = ix.columns.map((c) => `'${c}'`).join(",");
  return [
    "SELECT CASE",
    `WHEN ${table} IS NULL THEN 'no-table'`,
    `WHEN (SELECT count(*) FROM pg_attribute WHERE attrelid = ${table} AND attname IN (${columns}) AND NOT attisdropped) < ${ix.columns.length} THEN 'no-columns'`,
    `WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${ix.name}' AND conrelid = ${table}) THEN 'constraint'`,
    `WHEN EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = ${index} AND indrelid = ${table} AND indisvalid AND indisunique = ${ix.unique}) THEN 'valid'`,
    `WHEN ${index} IS NOT NULL THEN 'invalid'`,
    "ELSE 'missing' END",
  ].join(" ");
}

/** One index's block of the Job's shell script. */
function indexScript(ix: OnlineIndex): string {
  const table = checked(ix.table);
  const name = checked(ix.name);
  const columns = ix.columns.map((c) => `"${checked(c)}"`).join(", ");
  const create = `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "public"."${table}" (${columns})`;
  const label = `${name} (${ix.migration})`;
  return [
    `state="$(q "${stateQuery(ix)}")"`,
    `echo "${label}: $state"`,
    'case "$state" in',
    "  no-table|no-columns|constraint|valid) ;;",
    "  invalid|missing)",
    `    [ "$state" = missing ] || q 'DROP INDEX CONCURRENTLY IF EXISTS "public"."${name}"'`,
    `    q '${create}'`,
    `    after="$(q "${stateQuery(ix)}")"`,
    `    [ "$after" = valid ] || { echo "${label}: still $after after the build" >&2; exit 1; }`,
    `    echo "${label}: built" ;;`,
    `  *) echo "${label}: unexpected state '$state'" >&2; exit 1 ;;`,
    "esac",
  ].join("\n");
}

/** The whole Job's script: wait for Postgres, then each index in turn. */
export function onlineIndexScript(indexes: readonly OnlineIndex[] = ONLINE_INDEXES): string {
  return [
    "set -eu",
    // -X: no psqlrc. -A -t -q: the bare value. One statement per -c, so none
    // of them runs inside a transaction block, which CONCURRENTLY refuses.
    'q() { psql "$APP_MIGRATION_DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }',
    'until pg_isready -d "$APP_MIGRATION_DATABASE_URL" >/dev/null 2>&1; do echo "waiting for postgres"; sleep 2; done',
    ...indexes.map(indexScript),
    'echo "online indexes done"',
  ].join("\n");
}

/**
 * Builds {@link ONLINE_INDEXES} online, before the migration Job. Pulumi awaits
 * it, and the migration Job depends on it, so a failed build stops the deploy
 * before any migration takes a lock. Idempotent: on a database where the
 * migrations already ran (staging, and prod after its first deploy of 0196) it
 * reads one state per index and exits.
 *
 * `postgres:17-alpine`, as the other psql Jobs (`pg-init-tables`, the role
 * rename): the frontend image the migration Job runs has no `psql`. The
 * credentials are the migration Job's own, the schema owner, which an index
 * build on its tables needs.
 */
export function buildOnlineIndexes(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  // One name on both projects: it is new, and a legacy prefixed name exists
  // only to keep an existing resource's URN (names.ts).
  const name = "app-online-indexes";
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: { namespace: w.namespace },
      spec: {
        // A build that fails behind a long transaction is retried; a real fault
        // (duplicate rows for a unique index) fails each time and stops the deploy.
        backoffLimit: 6,
        // A bound in the cluster too, below the deploy workflow's 60 minutes.
        activeDeadlineSeconds: 45 * 60,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels: commonLabels(name) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "psql",
                image: "postgres:17-alpine",
                securityContext: hardenedJobSecurityContext(),
                resources: BOOTSTRAP_JOB_RESOURCES,
                env: [...migrationEnv(), { name: "PGOPTIONS", value: ONLINE_INDEX_SESSION }],
                command: ["/bin/sh", "-c", onlineIndexScript()],
              },
            ],
          },
        },
      },
    },
    {
      provider: w.provider,
      dependsOn: [secrets.secret, ...dependsOn],
      customTimeouts: { create: "50m", update: "50m" },
    },
  );
}
