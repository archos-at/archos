import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, KEDA_SCALER_CONNECTION_LIMIT, PORT } from "../constants";
import { commonLabels } from "../platform/namespaces";
import { secretChecksum, secretChecksumAnnotations } from "../platform/rollout";
import { onNodeGroup } from "../platform/scheduling";
import { hardenedJobSecurityContext } from "../platform/security";
import { scaledCpuRequest } from "../config/cpu-requests";

export const JOBS_DB = "jobs";
export const CHECKPOINTS_DB = "checkpoints";
export const APP_DB = "app";

export const RUNTIME_ROLE = "app_rw";

export const RENAME_SCRIPT = resolve(__dirname, "../../../postgres/rename-legacy-names.sh");

export interface PostgresRenameWiring {
  rwHost: string;
  superuserSecret: string;
  appSecret: pulumi.Input<string>;
  runtimeSecret: pulumi.Input<string>;
  scalerSecret: pulumi.Input<string>;
  passwords: Record<string, pulumi.Input<string>>;
}

export function installPostgresRename(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  wiring: PostgresRenameWiring,
  dependsOn: pulumi.Resource[],
): { job: k8s.batch.v1.Job; script: k8s.core.v1.ConfigMap } {
  const labels = commonLabels("pg-rename");
  const script = new k8s.core.v1.ConfigMap(
    "pg-rename-script",
    { metadata: { namespace, labels }, data: { "rename-legacy-names.sh": readFileSync(RENAME_SCRIPT, "utf8") } },
    { provider, replaceOnChanges: ["data"] },
  );
  const job = renameJob(cfg, provider, namespace, wiring, {
    name: "pg-rename-legacy-names",
    script,
    args: [],
    env: [{ name: "ENSURE_RLS_ROLES", value: "1" }],
    dependsOn,
  });
  return { job, script };
}

export function installRlsRoleRename(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  wiring: PostgresRenameWiring,
  script: k8s.core.v1.ConfigMap,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  return renameJob(cfg, provider, namespace, wiring, {
    name: "pg-rename-rls-roles",
    script,
    args: ["after-migrate"],
    env: [],
    dependsOn,
  });
}

function renameJob(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  wiring: PostgresRenameWiring,
  job: {
    name: string;
    script: k8s.core.v1.ConfigMap;
    args: string[];
    env: k8s.types.input.core.v1.EnvVar[];
    dependsOn: pulumi.Resource[];
  },
): k8s.batch.v1.Job {
  const labels = commonLabels("pg-rename");
  const fromSecret = (name: pulumi.Input<string>, key: string) => ({ secretKeyRef: { name, key } });

  return new k8s.batch.v1.Job(
    job.name,
    {
      metadata: { namespace, labels },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels, annotations: secretChecksumAnnotations(secretChecksum(wiring.passwords)) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "psql",
                image: "postgres:17-alpine",
                securityContext: hardenedJobSecurityContext(),
                resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                env: [
                  { name: "PGHOST", value: wiring.rwHost },
                  { name: "PGPORT", value: String(PORT.postgres) },
                  { name: "PGSSLMODE", value: "require" },
                  { name: "PGUSER", valueFrom: fromSecret(wiring.superuserSecret, "username") },
                  { name: "PGPASSWORD", valueFrom: fromSecret(wiring.superuserSecret, "password") },
                  { name: "ROLE_PASSWORD", valueFrom: fromSecret(wiring.appSecret, "password") },
                  { name: "RUNTIME_PASSWORD", valueFrom: fromSecret(wiring.runtimeSecret, "password") },
                  { name: "SCALER_PASSWORD", valueFrom: fromSecret(wiring.scalerSecret, "password") },
                  { name: "SCALER_CONNECTION_LIMIT", value: String(KEDA_SCALER_CONNECTION_LIMIT) },
                  ...job.env,
                ],
                command: ["sh", "/script/rename-legacy-names.sh", ...job.args],
                volumeMounts: [{ name: "script", mountPath: "/script" }],
              },
            ],
            volumes: [{ name: "script", configMap: { name: job.script.metadata.name } }],
          },
        },
      },
    },
    { provider, dependsOn: [job.script, ...job.dependsOn], customTimeouts: { create: "15m", update: "15m" } },
  );
}
