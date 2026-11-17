import { ingestJobsAtCeiling, type IngestWorkerConfig, type ProviderLimitsConfig } from "./workers";

export function vlmPageReadThreads(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): number {
  return ingestJobsAtCeiling(cfg.ingestWorker) * cfg.providerLimits.pageReadParallelism;
}

export function vlmPeakCalls(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): number {
  const threads = vlmPageReadThreads(cfg);
  const pool = cfg.providerLimits.vlmFleetConcurrency;
  return pool > 0 ? Math.min(threads, pool) : threads;
}

export function assertVlmPeakFitsCeiling(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): void {
  const { vlmFleetConcurrency, pageReadParallelism, limitCeiling, modelLimitCeiling } = cfg.providerLimits;
  if (vlmFleetConcurrency === 0) return;
  const { maxReplicas, concurrency, heavy } = cfg.ingestWorker;
  const documents = ingestJobsAtCeiling(cfg.ingestWorker);
  if (documents > vlmFleetConcurrency) {
    const heavyJobs = heavy?.enabled ? heavy.maxReplicas * heavy.concurrency : 0;
    const heavyTerm = heavyJobs
      ? ` + ingestWorkerHeavyMaxReplicas (${heavy.maxReplicas}) x ingestWorkerHeavyConcurrency (${heavy.concurrency})`
      : "";
    throw new Error(
      `Invalid ingest sizing: ingestWorkerMaxReplicas (${maxReplicas}) x ingestWorkerConcurrency (${concurrency})` +
        `${heavyTerm} = ${documents} documents read at once, more than vlmFleetConcurrency (${vlmFleetConcurrency}) ` +
        "vision slots. A document needs a slot to make progress, so the extra replicas would only wait and hold " +
        `memory. Lower ingestWorkerMaxReplicas to ${Math.max(1, Math.floor((vlmFleetConcurrency - heavyJobs) / concurrency))} ` +
        "or less, or raise vlmFleetConcurrency (and the provider's own limit with it).",
    );
  }
  if (pageReadParallelism > vlmFleetConcurrency) {
    throw new Error(
      `Invalid ingest sizing: ingestPageReadParallelism (${pageReadParallelism}) is above vlmFleetConcurrency ` +
        `(${vlmFleetConcurrency}). One file's threads past the fleet pool can never hold a slot. ` +
        "Lower ingestPageReadParallelism or raise vlmFleetConcurrency.",
    );
  }
  if (vlmFleetConcurrency > limitCeiling) {
    throw new Error(
      `Invalid provider budget: vlmFleetConcurrency (${vlmFleetConcurrency}) is above providerLimitCeiling ` +
        `(${limitCeiling}), the key-wide limit every model call passes. The fleet pool could never fill. ` +
        "Raise providerLimitCeiling or lower vlmFleetConcurrency.",
    );
  }
  if (vlmFleetConcurrency > modelLimitCeiling) {
    throw new Error(
      `Invalid provider budget: vlmFleetConcurrency (${vlmFleetConcurrency}) is above providerModelLimitCeiling ` +
        `(${modelLimitCeiling}), the limit on calls in flight to one model, which the vision model's calls also pass. ` +
        "Its own pool would hold the calls back below the fleet pool, so the extra slots and the replicas sized " +
        "to them would only wait. Raise providerModelLimitCeiling (and the provider's own limit with it) or lower " +
        "vlmFleetConcurrency.",
    );
  }
}
