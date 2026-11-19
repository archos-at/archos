import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { appPullPolicy, backendImage } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext, hardenedJobSecurityContext } from "../platform/security";
import { BACKFILL_POD, BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, LIGHT_WORKER_RESOURCES, UID } from "../constants";
import { AppSecrets, AppWiring, backendQdrantEnv } from "./config";
import { backfillDatabaseEnv } from "./job-env";
import { scaledCpuRequest } from "../config/cpu-requests";

type Container = k8s.types.input.core.v1.Container;

export const BACKFILLS_DIR = resolve(__dirname, "../../../../apps/workspace/backfills");
export const SQL_RUNNER = "run-sql.sh";
export const BACKFILL_PHASES = ["before-readers", "after-switch"] as const;
export type BackfillPhase = (typeof BACKFILL_PHASES)[number];
export const BACKFILL_JOB: Record<BackfillPhase, string> = {
  "before-readers": "app-backfill-before",
  "after-switch": "app-backfill-after",
};
export const BACKFILL_SESSION = "-c statement_timeout=0 -c lock_timeout=30s";
export const BACKFILL_DEADLINE_MINUTES = 60;
export const BACKFILL_DATABASES = ["app", "jobs"] as const;
export type BackfillDatabase = (typeof BACKFILL_DATABASES)[number];

const PSQL_IMAGE = "postgres:17-alpine";
const MOUNT = "/backfills";
const EXPIRES = /^drop after release \d{4}-W\d{2}$/;
const NAME = /^[a-z][a-z0-9-]*$/;

interface Common {
  name: string;
  phase: BackfillPhase;
  expires: string;
}
export interface SqlBackfill extends Common {
  kind: "sql";
  database: BackfillDatabase;
  dryRun: string;
  apply: string;
}
export interface QdrantBackfill extends Common {
  kind: "qdrant";
  command: string[];
}
export type Backfill = SqlBackfill | QdrantBackfill;

function invalid(name: string, why: string): never {
  throw new Error(`backfill ${name}: ${why}`);
}

function readManifest(dir: string, name: string): Backfill {
  if (!NAME.test(name)) invalid(name, "the directory name is not lower-case words joined by hyphens");
  const text = readFileSync(resolve(dir, name, "backfill.json"), "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  const { expires, kind, phase } = raw;
  if (typeof expires !== "string" || !EXPIRES.test(expires)) {
    invalid(name, `expires must read "drop after release YYYY-Www", got ${JSON.stringify(expires)}`);
  }
  if (!text.startsWith(`{"expires": "${expires}"`)) {
    invalid(name, 'the first line must open with {"expires": …}, where check_legacy_expiry reads the marker');
  }
  if (!BACKFILL_PHASES.includes(phase as BackfillPhase)) {
    invalid(name, `phase must be one of ${BACKFILL_PHASES.join(", ")}, got ${JSON.stringify(phase)}`);
  }
  const common = { name, expires, phase: phase as BackfillPhase };
  if (kind === "sql") {
    for (const key of ["dryRun", "apply"] as const) {
      const file = raw[key];
      if (typeof file !== "string" || !file.endsWith(".sql") || !existsSync(resolve(dir, name, file))) {
        invalid(name, `${key} must name a .sql file beside backfill.json, got ${JSON.stringify(file)}`);
      }
    }
    const database = raw.database ?? "app";
    if (!BACKFILL_DATABASES.includes(database as BackfillDatabase)) {
      invalid(name, `database must be one of ${BACKFILL_DATABASES.join(", ")}, got ${JSON.stringify(database)}`);
    }
    return {
      ...common,
      kind,
      database: database as BackfillDatabase,
      dryRun: raw.dryRun as string,
      apply: raw.apply as string,
    };
  }
  if (kind === "qdrant") {
    const { command } = raw;
    if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === "string" && c)) {
      invalid(name, "command must be the dry run's argv in the backend image");
    }
    return { ...common, kind, command: command as string[] };
  }
  return invalid(name, `kind must be sql or qdrant, got ${JSON.stringify(kind)}`);
}

export function loadBackfills(dir = BACKFILLS_DIR): Backfill[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readManifest(dir, name));
}

export function sqlFiles(backfills: Backfill[], dir = BACKFILLS_DIR): Record<string, string> {
  const files: Record<string, string> = { [SQL_RUNNER]: readFileSync(resolve(dir, SQL_RUNNER), "utf8") };
  for (const b of backfills) {
    if (b.kind !== "sql") continue;
    files[`${b.name}.dry-run.sql`] = readFileSync(resolve(dir, b.name, b.dryRun), "utf8");
    files[`${b.name}.apply.sql`] = readFileSync(resolve(dir, b.name, b.apply), "utf8");
  }
  return files;
}

function sqlContainer(b: SqlBackfill): Container {
  return {
    name: b.name,
    image: PSQL_IMAGE,
    securityContext: hardenedJobSecurityContext(),
    resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
    env: [...backfillDatabaseEnv(b.database), { name: "PGOPTIONS", value: BACKFILL_SESSION }],
    command: [
      "sh",
      `${MOUNT}/${SQL_RUNNER}`,
      b.name,
      b.phase,
      `${MOUNT}/${b.name}.dry-run.sql`,
      `${MOUNT}/${b.name}.apply.sql`,
    ],
    volumeMounts: [{ name: "backfills", mountPath: MOUNT, readOnly: true }],
  };
}

export const QDRANT_SEQUENCE = 'set -e; "$@"; "$@" --apply; "$@" --check';

function qdrantContainer(w: AppWiring, cfg: DeployConfig, b: QdrantBackfill): Container {
  return {
    name: b.name,
    image: backendImage(cfg),
    imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
    securityContext: {
      ...hardenedContainerSecurityContext(),
      runAsNonRoot: true,
      runAsUser: UID.backend,
      runAsGroup: UID.backend,
    },
    resources: scaledCpuRequest(LIGHT_WORKER_RESOURCES),
    env: backendQdrantEnv(w),
    command: ["sh", "-c", QDRANT_SEQUENCE, b.name, ...b.command],
  };
}

export function installBackfills(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  phase: BackfillPhase,
  dependsOn: pulumi.Resource[],
  backfills: Backfill[] = loadBackfills(),
): k8s.batch.v1.Job | undefined {
  const due = backfills.filter((b) => b.phase === phase);
  if (due.length === 0) return undefined;
  const name = BACKFILL_JOB[phase];
  const files = sqlFiles(due);
  const digest = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 10);
  const scripts = new k8s.core.v1.ConfigMap(
    `${name}-scripts`,
    { metadata: { namespace: w.namespace, labels: commonLabels(name) }, data: files },
    { provider: w.provider },
  );
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: { namespace: w.namespace, labels: commonLabels(name) },
      spec: {
        backoffLimit: 1,
        activeDeadlineSeconds: BACKFILL_DEADLINE_MINUTES * 60,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: {
            labels: commonLabels(BACKFILL_POD),
            annotations: { "deploy/image-tag": cfg.images.tag, "deploy/backfills": digest },
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            restartPolicy: "Never",
            ...onNodeGroup(cfg.nodeGroups.app),
            volumes: [{ name: "backfills", configMap: { name: scripts.metadata.name } }],
            initContainers: due.map((b) => (b.kind === "sql" ? sqlContainer(b) : qdrantContainer(w, cfg, b))),
            containers: [
              {
                name: "done",
                image: PSQL_IMAGE,
                securityContext: hardenedJobSecurityContext(),
                resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                command: ["sh", "-c", `echo '{"event":"backfill.phase","phase":"${phase}","backfills":${due.length}}'`],
              },
            ],
          },
        },
      },
    },
    {
      provider: w.provider,
      dependsOn: [secrets.secret, scripts, ...dependsOn],
      customTimeouts: { create: `${BACKFILL_DEADLINE_MINUTES + 5}m`, update: `${BACKFILL_DEADLINE_MINUTES + 5}m` },
    },
  );
}
