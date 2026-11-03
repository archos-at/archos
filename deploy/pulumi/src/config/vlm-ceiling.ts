import type { IngestWorkerConfig, ProviderLimitsConfig } from "./workers";
/**
 * The VLM call ceiling: what the ingest tier can have in flight against the provider limit.
 *
 * Two bounds, with two jobs. The fleet's lease pool (`VLM_FLEET_CONCURRENCY`, on
 * Dragonfly, shared fairly between offices) caps the vision calls in flight, whatever
 * the replica count: a call over it waits for a slot. Each file's page-read pool
 * (`INGEST_PAGE_READ_PARALLELISM`, OCR and vision together) bounds that file's threads
 * and the rendered pages it holds, not the calls the provider sees.
 */

/**
 * Page reads the ingest tier asks for at its ceiling: replicas, times the jobs one
 * replica runs at once, times one file's page-read pool. Every one asks the fleet
 * pool for a slot; most of them wait there once the pool is full.
 */
export function vlmPageReadThreads(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): number {
  return cfg.ingestWorker.maxReplicas * cfg.ingestWorker.concurrency * cfg.providerLimits.pageReadParallelism;
}

/**
 * Vision calls in flight at the ceiling: the threads that ask, capped by the fleet pool.
 * A pool that is off (0) caps nothing.
 */
export function vlmPeakCalls(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): number {
  const threads = vlmPageReadThreads(cfg);
  const pool = cfg.providerLimits.vlmFleetConcurrency;
  return pool > 0 ? Math.min(threads, pool) : threads;
}

/**
 * Refuse a sizing in which the bounds stop meaning what they say:
 *
 * - more documents running at once (replicas x concurrency) than the fleet pool has
 *   slots: a document needs a slot to make progress at all, so the extra replicas
 *   only hold memory while they wait;
 * - one file's page-read pool larger than the fleet pool: its extra threads can
 *   never hold a slot;
 * - a fleet pool larger than either limiter ceiling it passes through: the key-wide
 *   one, and the vision model's own (every vision call holds a slot in both, and the
 *   model's pool is the smaller by default, so a bigger fleet pool could never fill).
 *
 * The numbers are chosen in two places (the tier's replicas, the provider's budget)
 * and neither looks wrong alone. Skipped when the pool is off (`vlmFleetConcurrency`
 * 0: nothing is held back).
 */
export function assertVlmPeakFitsCeiling(cfg: { ingestWorker: IngestWorkerConfig; providerLimits: ProviderLimitsConfig }): void {
  const { vlmFleetConcurrency, pageReadParallelism, limitCeiling, modelLimitCeiling } = cfg.providerLimits;
  if (vlmFleetConcurrency === 0) return;
  const { maxReplicas, concurrency } = cfg.ingestWorker;
  const documents = maxReplicas * concurrency;
  if (documents > vlmFleetConcurrency) {
    throw new Error(
      `Invalid ingest sizing: ingestWorkerMaxReplicas (${maxReplicas}) x ingestWorkerConcurrency (${concurrency}) ` +
        `= ${documents} documents read at once, more than vlmFleetConcurrency (${vlmFleetConcurrency}) vision slots. ` +
        "A document needs a slot to make progress, so the extra replicas would only wait and hold memory. Lower " +
        `ingestWorkerMaxReplicas to ${Math.max(1, Math.floor(vlmFleetConcurrency / concurrency))} or less, or raise ` +
        "vlmFleetConcurrency (and the provider's own limit with it).",
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
