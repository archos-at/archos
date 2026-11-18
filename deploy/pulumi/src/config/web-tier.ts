import * as pulumi from "@pulumi/pulumi";
import { num } from "./readers";
import type { ResourceSpec } from "./resources";

export interface FrontendConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  hpaCpuTargetPercent: number;
}

export interface WebConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  hpaCpuTargetPercent: number;
}

export function loadWebTier(cfg: pulumi.Config): { frontend: FrontendConfig; web: WebConfig } {
  const webMinReplicas = num(cfg, "webMinReplicas", 2);
  if (webMinReplicas < 2) {
    throw new Error(
      `grid-oib:webMinReplicas must be >= 2 (got ${webMinReplicas}). The web PodDisruptionBudget ` +
        "allows maxUnavailable 1, so a single replica means a full landing-site outage during " +
        "any voluntary disruption.",
    );
  }
  return {
    frontend: {
      resources: {
        requestsCpu: cfg.get("frontendRequestsCpu") ?? "925m",
        requestsMemory: cfg.get("frontendRequestsMemory") ?? "512Mi",
        limitsCpu: cfg.get("frontendLimitsCpu") ?? "1",
        limitsMemory: cfg.get("frontendLimitsMemory") ?? "1536Mi",
      },
      minReplicas: num(cfg, "frontendMinReplicas", 2),
      maxReplicas: num(cfg, "frontendMaxReplicas", 6),
      hpaCpuTargetPercent: num(cfg, "frontendHpaCpuTargetPercent", 38),
    },
    web: {
      resources: {
        requestsCpu: cfg.get("webRequestsCpu") ?? "100m",
        requestsMemory: cfg.get("webRequestsMemory") ?? "128Mi",
        limitsCpu: cfg.get("webLimitsCpu") ?? "250m",
        limitsMemory: cfg.get("webLimitsMemory") ?? "256Mi",
      },
      minReplicas: webMinReplicas,
      maxReplicas: num(cfg, "webMaxReplicas", 4),
      hpaCpuTargetPercent: num(cfg, "webHpaCpuTargetPercent", 70),
    },
  };
}
