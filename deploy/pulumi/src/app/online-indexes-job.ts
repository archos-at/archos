import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { onNodeGroup } from "../platform/scheduling";
import { DeployConfig } from "../config";
import { commonLabels } from "../platform/namespaces";
import { hardenedJobSecurityContext } from "../platform/security";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS } from "../constants";
import { AppSecrets, AppWiring } from "./config";
import { migrationEnv } from "./job-env";

export interface OnlineIndex {
  migration: string;
  table: string;
  name: string;
  columns: readonly string[];
  unique: boolean;
}

export const ONLINE_INDEXES: readonly OnlineIndex[] = [
  {
    migration: "0196",
    table: "document_versions",
    name: "document_versions_id_project_id_key",
    columns: ["id", "project_id"],
    unique: true,
  },
];

export const ONLINE_INDEX_SESSION = "-c statement_timeout=0 -c lock_timeout=30s";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function checked(id: string): string {
  if (!IDENTIFIER.test(id)) throw new Error(`online index: '${id}' is not a plain lower-case SQL identifier`);
  return id;
}

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

export function onlineIndexScript(indexes: readonly OnlineIndex[] = ONLINE_INDEXES): string {
  return [
    "set -eu",
    'q() { psql "$APP_MIGRATION_DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }',
    'until pg_isready -d "$APP_MIGRATION_DATABASE_URL" >/dev/null 2>&1; do echo "waiting for postgres"; sleep 2; done',
    ...indexes.map(indexScript),
    'echo "online indexes done"',
  ].join("\n");
}

export function buildOnlineIndexes(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const name = "app-online-indexes";
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: { namespace: w.namespace },
      spec: {
        backoffLimit: 6,
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
