import * as pulumi from "@pulumi/pulumi";
import { GOTENBERG_SLOTS_PER_REPLICA } from "../rendition-sizing";
import { bool, num } from "./readers";
import type { ResourceSpec } from "./resources";

export interface GotenbergConfig {
  enabled: boolean;
  image: string;
  replicas: number;
}

export interface IngestWorkerConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
  drainSeconds: number;
  maxPerOrg: number;
  maxImagePixels: number;
  heavy: IngestHeavyConfig;
}

export interface IngestHeavyConfig {
  enabled: boolean;
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
  fileBytes: number;
}

export function ingestJobsAtCeiling(ingest: IngestWorkerConfig): number {
  const heavy = ingest.heavy?.enabled ? ingest.heavy.maxReplicas * ingest.heavy.concurrency : 0;
  return ingest.maxReplicas * ingest.concurrency + heavy;
}

export function heavyFileBytesEnv(ingest: IngestWorkerConfig): number {
  return ingest.heavy.enabled ? ingest.heavy.fileBytes : 0;
}

export interface BffJobsConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
  drainSeconds: number;
  maxPerOrg: number;
  renditionConcurrency: number;
}

export interface KedaConfig { install: boolean }

export interface ProviderLimitsConfig {
  vlmFleetConcurrency: number;
  pageReadParallelism: number;
  limitCeiling: number;
  modelLimitCeiling: number;
}

export function assertBffJobsRunsSchedules(enabled: boolean, minReplicas: number): void {
  const why =
    "the bff-jobs pool is the only worker of the scheduled automations and the maintenance sweeps " +
    "(Hatchet crons, apps/workspace/bff/scheduling/tasks.ts), and KEDA scales it on the bff-job backlog only, " +
    "so without a running replica nothing fires or prunes.";
  if (!enabled) throw new Error(`bffJobsEnabled=false is refused: ${why}`);
  if (minReplicas < 1) throw new Error(`bffJobsMinReplicas must be at least 1, not ${minReplicas}: ${why}`);
}

export function loadWorkers(
  cfg: pulumi.Config,
): { gotenberg: GotenbergConfig; ingestWorker: IngestWorkerConfig; bffJobs: BffJobsConfig; keda: KedaConfig; providerLimits: ProviderLimitsConfig } {
  const bffJobsMinReplicas = num(cfg, "bffJobsMinReplicas", 1);
  assertBffJobsRunsSchedules(cfg.getBoolean("bffJobsEnabled") !== false, bffJobsMinReplicas);
  return {
    gotenberg: {
      enabled: bool(cfg, "gotenbergEnabled", true),
      image: cfg.get("gotenbergImage") ?? "gotenberg/gotenberg:8.37.0-libreoffice",
      replicas: Math.max(
        1,
        num(
          cfg,
          "gotenbergReplicas",
          Math.ceil(
            (Math.max(1, num(cfg, "bffJobsMaxReplicas", 4)) * Math.max(1, num(cfg, "bffJobsRenditionConcurrency", 1))) /
              GOTENBERG_SLOTS_PER_REPLICA,
          ),
        ),
      ),
    },
    ingestWorker: {
      resources: {
        requestsCpu: cfg.get("ingestWorkerRequestsCpu") ?? "500m",
        requestsMemory: cfg.get("ingestWorkerRequestsMemory") ?? "4Gi",
        limitsCpu: cfg.get("ingestWorkerLimitsCpu") ?? "2",
        limitsMemory: cfg.get("ingestWorkerLimitsMemory") ?? "6Gi",
      },
      minReplicas: Math.max(0, num(cfg, "ingestWorkerMinReplicas", 1)),
      maxReplicas: Math.max(1, num(cfg, "ingestWorkerMaxReplicas", 5)),
      concurrency: Math.max(1, num(cfg, "ingestWorkerConcurrency", 3)),
      drainSeconds: Math.max(30, num(cfg, "ingestWorkerDrainSeconds", 600)),
      maxPerOrg: Math.max(0, num(cfg, "ingestMaxPerOrg", 0)),
      maxImagePixels: Math.max(0, num(cfg, "ingestWorkerMaxImagePixels", 268_435_456)),
      heavy: {
        enabled: bool(cfg, "ingestWorkerHeavyEnabled", true),
        resources: {
          requestsCpu: cfg.get("ingestWorkerHeavyRequestsCpu") ?? "1",
          requestsMemory: cfg.get("ingestWorkerHeavyRequestsMemory") ?? "12Gi",
          limitsCpu: cfg.get("ingestWorkerHeavyLimitsCpu") ?? "2",
          limitsMemory: cfg.get("ingestWorkerHeavyLimitsMemory") ?? "12Gi",
        },
        minReplicas: Math.max(0, num(cfg, "ingestWorkerHeavyMinReplicas", 0)),
        maxReplicas: Math.max(1, num(cfg, "ingestWorkerHeavyMaxReplicas", 1)),
        concurrency: Math.max(1, num(cfg, "ingestWorkerHeavyConcurrency", 1)),
        fileBytes: Math.max(1, num(cfg, "ingestHeavyFileBytes", 41_943_040)),
      },
    },
    bffJobs: {
      resources: {
        requestsCpu: cfg.get("bffJobsRequestsCpu") ?? "250m",
        requestsMemory: cfg.get("bffJobsRequestsMemory") ?? "512Mi",
        limitsCpu: cfg.get("bffJobsLimitsCpu") ?? "1",
        limitsMemory: cfg.get("bffJobsLimitsMemory") ?? "2Gi",
      },
      minReplicas: bffJobsMinReplicas,
      maxReplicas: Math.max(1, num(cfg, "bffJobsMaxReplicas", 4)),
      concurrency: Math.max(1, num(cfg, "bffJobsConcurrency", 2)),
      drainSeconds: Math.max(15, num(cfg, "bffJobsDrainSeconds", 60)),
      maxPerOrg: Math.max(0, num(cfg, "bffJobsMaxPerOrg", 0)),
      renditionConcurrency: Math.max(1, num(cfg, "bffJobsRenditionConcurrency", 1)),
    },
    keda: { install: cfg.getBoolean("installKeda") ?? true },
    providerLimits: {
      vlmFleetConcurrency: Math.max(0, num(cfg, "vlmFleetConcurrency", 32)),
      pageReadParallelism: Math.max(1, num(cfg, "ingestPageReadParallelism", 16)),
      limitCeiling: Math.max(1, num(cfg, "providerLimitCeiling", 128)),
      modelLimitCeiling: Math.max(1, num(cfg, "providerModelLimitCeiling", 32)),
    },
  };
}
