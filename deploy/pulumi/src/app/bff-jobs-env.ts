import * as k8s from "@pulumi/kubernetes";
import { APP_DEFAULTS } from "../constants";
import { AppWiring, frontendEnv, langfuseApiEnv } from "./config";

export const BFF_JOBS_SERVICE_NAME = "grid-bff-jobs";

type EnvVar = k8s.types.input.core.v1.EnvVar;

const BFF_JOBS_OVERRIDES = new Set(["OTEL_SERVICE_NAME", "SHUTDOWN_DRAIN_MS"]);

const BFF_JOBS_WITHHELD = new Set([
  "LANGFUSE_HOST",
  "LANGFUSE_PUBLIC_URL",
  "LANGFUSE_PROJECT_ID",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "GEOCODER_URL",
  "INBOUND_MAIL_SIGNING_KEYS",
  "INBOUND_MAIL_PAUSED",
]);
const inheritedByBffJobs = (env: EnvVar) =>
  typeof env.name !== "string" || !(BFF_JOBS_OVERRIDES.has(env.name) || BFF_JOBS_WITHHELD.has(env.name));

export function bffJobsEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    ...frontendEnv(w).filter(inheritedByBffJobs),
    { name: "BFF_JOBS_CONCURRENCY", value: String(cfg.bffJobs.concurrency) },
    { name: "BFF_JOBS_DRAIN_SECONDS", value: String(cfg.bffJobs.drainSeconds) },
    { name: "BFF_JOBS_MAX_PER_ORG", value: String(cfg.bffJobs.maxPerOrg) },
    { name: "GOTENBERG_MAX_CONCURRENCY", value: String(cfg.bffJobs.renditionConcurrency) },
    { name: "SHUTDOWN_DRAIN_MS", value: "5000" },
    { name: "SKILL_RUNS_RETENTION_DAYS", value: String(APP_DEFAULTS.skillRunsRetentionDays) },
    ...(cfg.langfuse.enabled
      ? [
          ...langfuseApiEnv(cfg),
          { name: "TRACE_RETENTION_DAYS", value: String(APP_DEFAULTS.langfuseTraceRetentionDays) },
        ]
      : []),
    ...(cfg.observability.enabled ? [{ name: "OTEL_SERVICE_NAME", value: BFF_JOBS_SERVICE_NAME }] : []),
  ];
}
