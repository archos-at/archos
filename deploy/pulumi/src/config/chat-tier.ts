import * as pulumi from "@pulumi/pulumi";
import { bool, num } from "./readers";
import type { ResourceSpec } from "./resources";

export function backendAutoscaled(c: { backend: BackendConfig }): boolean {
  return !c.backend.chatAffinity && c.backend.maxReplicas > c.backend.replicas;
}

export interface BackendConfig {
  resources: ResourceSpec;
  legacyResources: ResourceSpec;
  maxActiveJobsPerOrg: number;
  maxQueuedJobsPerOrg: number;
  ingestMaxWorkers: number;
  configFile: string;
  replicas: number;
  maxReplicas: number;
  turnsPerReplica: number;
  cpuTargetPercent: number;
  drainSeconds: number;
  chatAffinity: boolean;
}

export interface ApiConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  hpaCpuTargetPercent: number;
}

export interface AgentWorkerConfig {
  resources: ResourceSpec;
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
  drainSeconds: number;
}

export function loadChatTier(
  cfg: pulumi.Config,
): { backend: BackendConfig; api: ApiConfig; conversationBus: boolean; agentWorker: AgentWorkerConfig } {
  const conversationBus = bool(cfg, "conversationBus", true);
  const backendReplicas = Math.max(1, num(cfg, "backendReplicas", 2));
  const backendMaxReplicas = Math.max(1, num(cfg, "backendMaxReplicas", 3));
  const chatAffinity = bool(cfg, "chatAffinity", true);
  if (backendMaxReplicas < backendReplicas) {
    throw new Error(
      `grid-oib:backendMaxReplicas (${backendMaxReplicas}) must be >= backendReplicas ` +
        `(${backendReplicas}), the floor the chat tier scales between.`,
    );
  }
  const apiMinReplicas = Math.max(1, num(cfg, "apiMinReplicas", 2));
  const apiMaxReplicas = Math.max(1, num(cfg, "apiMaxReplicas", 4));
  if (apiMaxReplicas < apiMinReplicas) {
    throw new Error(
      `grid-oib:apiMaxReplicas (${apiMaxReplicas}) must be >= apiMinReplicas ` +
        `(${apiMinReplicas}), the floor the api tier's HPA scales between.`,
    );
  }
  if (!chatAffinity && !conversationBus) {
    throw new Error(
      "grid-oib:chatAffinity=false needs grid-oib:conversationBus=true: without the Dragonfly " +
        "conversation bus no replica can relay a turn it does not run, or stop a stale one (ADR-0080).",
    );
  }
  const backendResources: ResourceSpec = {
    requestsCpu: cfg.get("backendRequestsCpu") ?? "1",
    requestsMemory: cfg.get("backendRequestsMemory") ?? "2Gi",
    limitsCpu: cfg.get("backendLimitsCpu") ?? "4",
    limitsMemory: cfg.get("backendLimitsMemory") ?? "8Gi",
  };
  return {
    backend: {
      resources: backendResources,
      legacyResources: { ...backendResources, requestsCpu: cfg.get("legacyChatRequestsCpu") ?? backendResources.requestsCpu },
      maxActiveJobsPerOrg: num(cfg, "backendMaxActiveJobsPerOrg", 3),
      maxQueuedJobsPerOrg: num(cfg, "backendMaxQueuedJobsPerOrg", 50),
      ingestMaxWorkers: num(cfg, "backendIngestMaxWorkers", 2),
      configFile: cfg.get("backendConfigFile") ?? "/app/configs/config_oib_openrouter.yml",
      replicas: backendReplicas,
      maxReplicas: backendMaxReplicas,
      turnsPerReplica: Math.max(1, num(cfg, "backendTurnsPerReplica", 8)),
      cpuTargetPercent: num(cfg, "backendCpuTargetPercent", 70),
      drainSeconds: Math.max(10, num(cfg, "backendDrainSeconds", chatAffinity ? 20 : 2730)),
      chatAffinity,
    },
    api: {
      resources: {
        requestsCpu: cfg.get("apiRequestsCpu") ?? "875m",
        requestsMemory: cfg.get("apiRequestsMemory") ?? "1536Mi",
        limitsCpu: cfg.get("apiLimitsCpu") ?? "2",
        limitsMemory: cfg.get("apiLimitsMemory") ?? "6Gi",
      },
      minReplicas: apiMinReplicas,
      maxReplicas: apiMaxReplicas,
      hpaCpuTargetPercent: num(cfg, "apiHpaCpuTargetPercent", 40),
    },
    conversationBus,
    agentWorker: {
      resources: {
        requestsCpu: cfg.get("agentWorkerRequestsCpu") ?? "375m",
        requestsMemory: cfg.get("agentWorkerRequestsMemory") ?? "2Gi",
        limitsCpu: cfg.get("agentWorkerLimitsCpu") ?? "4",
        limitsMemory: cfg.get("agentWorkerLimitsMemory") ?? "8Gi",
      },
      minReplicas: Math.max(0, num(cfg, "agentWorkerMinReplicas", 1)),
      maxReplicas: Math.max(1, num(cfg, "agentWorkerMaxReplicas", 8)),
      concurrency: Math.max(1, num(cfg, "agentWorkerConcurrency", 1)),
      drainSeconds: Math.max(30, num(cfg, "agentWorkerDrainSeconds", 600)),
    },
  };
}
