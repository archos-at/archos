/**
 * The bff-jobs pool's environment (ADR-0079), apart from the pool's manifests in
 * `bff-jobs.ts` so `config.ts` does not have to grow with every runner setting.
 */
import * as k8s from "@pulumi/kubernetes";
import { APP_DEFAULTS } from "../constants";
import { AppWiring, frontendEnv, langfuseApiEnv } from "./config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/**
 * Names the bff-jobs pod sets differently from the frontend it is built from.
 * The BFF in that pod is not the gateway: it logs as its own service, and the
 * runner stops it only after the jobs in hand are given back, so it needs no
 * long WebSocket drain of its own.
 */
const BFF_JOBS_OVERRIDES = new Set(["OTEL_SERVICE_NAME", "SHUTDOWN_DRAIN_MS"]);

/**
 * Names the bff-jobs pod does not inherit from the frontend: the frontend's
 * Langfuse settings. The pod gets the API keys back on their own
 * (`langfuseApiEnv`, below), for the two trace sweeps it runs on Hatchet
 * (`trace-retention`, `conversation-trace-erasure`; ADR-0044, ADR-0150), and
 * `allow-workers-to-langfuse` admits it to the web port for them.
 *
 * The geocoder's URL likewise: address search is a request-path feature, and
 * `geocoder-frontend-only` admits the frontend alone (ADR-0120).
 */
const BFF_JOBS_WITHHELD = new Set([
  "LANGFUSE_HOST",
  "LANGFUSE_PUBLIC_URL",
  "LANGFUSE_PROJECT_ID",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "GEOCODER_URL",
]);
const inheritedByBffJobs = (env: EnvVar) =>
  typeof env.name !== "string" || !(BFF_JOBS_OVERRIDES.has(env.name) || BFF_JOBS_WITHHELD.has(env.name));

/**
 * bff-jobs pool environment (ADR-0079): the whole frontend environment, because
 * the jobs call the same services the routes do (the database, object storage,
 * the backend, WorkOS), plus what the runner reads. Every `BFF_JOBS_` name
 * here must be one `apps/workspace/workers/jobs/index.js` reads; `bff-jobs.spec.ts`
 * holds the two together.
 */
export function bffJobsEnv(w: AppWiring): EnvVar[] {
  const { cfg } = w;
  return [
    ...frontendEnv(w).filter(inheritedByBffJobs),
    { name: "BFF_JOBS_CONCURRENCY", value: String(cfg.bffJobs.concurrency) },
    { name: "BFF_JOBS_DRAIN_SECONDS", value: String(cfg.bffJobs.drainSeconds) },
    { name: "BFF_JOBS_MAX_PER_ORG", value: String(cfg.bffJobs.maxPerOrg) },
    // Office conversions this pod runs at Gotenberg at once. The BFF in the pod
    // reads it as it does in the frontend (`rendition.ts`); here it is the
    // per-pod factor of the pool's ceiling (`renditionCeiling`), which
    // `gotenberg.spec.ts` holds to the converter's capacity.
    { name: "GOTENBERG_MAX_CONCURRENCY", value: String(cfg.bffJobs.renditionConcurrency) },
    // The BFF is stopped AFTER the runner has drained, so it only has to close
    // its own idle connections.
    { name: "SHUTDOWN_DRAIN_MS", value: "5000" },
    // The scheduling tasks (`bff/scheduling/sweeps.ts`): run-history retention,
    // and the Langfuse trace sweeps, a no-op without the keys.
    { name: "SKILL_RUNS_RETENTION_DAYS", value: String(APP_DEFAULTS.skillRunsRetentionDays) },
    ...(cfg.langfuse.enabled
      ? [
          ...langfuseApiEnv(cfg),
          { name: "TRACE_RETENTION_DAYS", value: String(APP_DEFAULTS.langfuseTraceRetentionDays) },
        ]
      : []),
    // The collector endpoint came with the frontend's; only the name differs.
    ...(cfg.observability.enabled ? [{ name: "OTEL_SERVICE_NAME", value: "grid-bff-jobs" }] : []),
  ];
}
