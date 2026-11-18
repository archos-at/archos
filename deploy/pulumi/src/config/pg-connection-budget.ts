import type { LangfuseConfig } from "./langfuse";
import type { PostgresConfig } from "./postgres";
import type { SeaweedfsConfig } from "./seaweedfs";
import { ingestJobsAtCeiling, type BffJobsConfig, type IngestWorkerConfig } from "./workers";
import { BACKGROUND_WORK } from "./background-work";
import {
  KEDA_SCALER_CONNECTION_LIMIT,
  POOLED_POOLS,
  POSTGRES_DIRECT_RESERVE,
  POSTGRES_POOLER,
  POSTGRES_TUNING,
} from "../constants";

export interface PgConnectionBudget {
  limit: number;
  pooled: number;
  reserve: Array<{ name: string; connections: number }>;
  reserveTotal: number;
  total: number;
}

type PgBudgetInputs = { postgres: PostgresConfig; ingestWorker: IngestWorkerConfig; langfuse: LangfuseConfig; seaweedfs: SeaweedfsConfig; bffJobs: BffJobsConfig };

export function pgConnectionBudget(cfg: PgBudgetInputs): PgConnectionBudget {
  const { instances, poolSize } = cfg.postgres.pooler;
  const pooled = instances * (POOLED_POOLS.length * poolSize + POSTGRES_POOLER.authConnections);
  const filerOnPostgres = cfg.seaweedfs.topology === "split" && cfg.seaweedfs.filerStore === "postgres";
  const ingestJobsInFlight = ingestJobsAtCeiling(cfg.ingestWorker);
  const reserve = [
    { name: "superuser_reserved_connections", connections: POSTGRES_DIRECT_RESERVE.superuser },
    { name: "CloudNativePG (instance manager, exporter, backup)", connections: POSTGRES_DIRECT_RESERVE.cnpg },
    { name: "job SSE LISTEN streams", connections: POSTGRES_DIRECT_RESERVE.sseListen },
    {
      name: "session advisory locks (ingest jobs in flight + background)",
      connections: ingestJobsInFlight + POSTGRES_DIRECT_RESERVE.sessionLocksBackground,
    },
    { name: "migration and bootstrap Jobs", connections: POSTGRES_DIRECT_RESERVE.bootstrapJobs },
    { name: "KEDA scaler login", connections: KEDA_SCALER_CONNECTION_LIMIT },
    { name: "Langfuse (Prisma)", connections: cfg.langfuse.enabled ? POSTGRES_DIRECT_RESERVE.langfuse : 0 },
    {
      name: "SeaweedFS filer store",
      connections: filerOnPostgres ? cfg.seaweedfs.filerReplicas * POSTGRES_DIRECT_RESERVE.filerPerReplica : 0,
    },
  ];
  const reserveTotal = reserve.reduce((sum, part) => sum + part.connections, 0);
  return { limit: Number(POSTGRES_TUNING.maxConnections), pooled, reserve, reserveTotal, total: pooled + reserveTotal };
}

export function assertPgConnectionBudget(cfg: PgBudgetInputs): void {
  const budget = pgConnectionBudget(cfg);
  if (budget.total <= budget.limit) return;
  const { instances, poolSize } = cfg.postgres.pooler;
  const parts = budget.reserve.filter((part) => part.connections > 0).map((part) => `${part.name} ${part.connections}`);
  throw new Error(
    `Invalid Postgres connection budget: ${budget.total} connections at the peak, more than max_connections ` +
      `(${budget.limit}). The pooler can hold ${budget.pooled} (pgPoolerInstances ${instances} x (${POOLED_POOLS.length} ` +
      `pooled database/role pairs x pgPoolerPoolSize ${poolSize} + ${POSTGRES_POOLER.authConnections} auth session)) ` +
      `and the direct connections need ${budget.reserveTotal} (${parts.join(", ")}). ` +
      "Lower pgPoolerPoolSize or pgPoolerInstances, or raise POSTGRES_TUNING.maxConnections (and the primary's memory with it).",
  );
}

export function backgroundWorkPgConnectionBudget(): PgConnectionBudget & { hatchetRole: number } {
  const perProcess = BACKGROUND_WORK.engineMaxConns;
  const processes =
    Object.values(BACKGROUND_WORK.replicas).reduce((sum, replicas) => sum + replicas + 1, 0) +
    BACKGROUND_WORK.bootstrapProcesses;
  const hatchetRole = processes * perProcess;
  const reserve = [
    { name: "superuser_reserved_connections", connections: POSTGRES_DIRECT_RESERVE.superuser },
    { name: "CloudNativePG (instance manager, exporter, backup)", connections: POSTGRES_DIRECT_RESERVE.cnpg },
    { name: "KEDA scaler login", connections: KEDA_SCALER_CONNECTION_LIMIT },
    { name: "grants Job", connections: 1 },
  ];
  const reserveTotal = reserve.reduce((sum, part) => sum + part.connections, 0);
  return {
    limit: BACKGROUND_WORK.maxConnections,
    pooled: hatchetRole,
    hatchetRole,
    reserve,
    reserveTotal,
    total: hatchetRole + reserveTotal,
  };
}

export function assertBackgroundWorkPgConnectionBudget(): void {
  const budget = backgroundWorkPgConnectionBudget();
  if (budget.total <= budget.limit) return;
  throw new Error(
    `Invalid background-work-pg connection budget: ${budget.total} connections at the peak, more than ` +
      `max_connections (${budget.limit}): Hatchet ${budget.hatchetRole}, reserve ${budget.reserveTotal}. ` +
      "Lower BACKGROUND_WORK.engineMaxConns or the replicas, or raise BACKGROUND_WORK.maxConnections.",
  );
}
