import type { DeployConfig } from './config'

export const GOTENBERG_SLOTS_PER_REPLICA = 2;

export function renditionCeiling(cfg: Pick<DeployConfig, "bffJobs">): number {
  return cfg.bffJobs.maxReplicas * cfg.bffJobs.renditionConcurrency;
}

export function gotenbergCapacity(cfg: Pick<DeployConfig, "gotenberg">): number {
  return cfg.gotenberg.replicas * GOTENBERG_SLOTS_PER_REPLICA;
}
