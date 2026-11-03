import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { AppWiring } from "./config";
import { hatchetNamespace } from "./hatchet-env";

/**
 * What every ScaledObject in the program has in common (ADR-0079), so the four
 * tiers KEDA scales (`ingest-worker`, `agent-worker`, `bff-jobs`, `aiq-agent`)
 * cannot drift apart in the parts that are not about their own signal: how often
 * it polls, how it scales in, what it does when its trigger cannot be read, and
 * how it authenticates.
 *
 * The three queue tiers differ only in the Hatchet workflow whose backlog they
 * count, the Deployment they move and the runs one replica takes, so
 * {@link installQueueScaledObject} takes exactly those. The chat tier's trigger is not a queue and it carries a cpu
 * trigger beside it, so it builds its own spec and shares the pieces below.
 */

/** Seconds between two polls of a trigger. */
export const SCALER_POLLING_SECONDS = 15;

/** The TriggerAuthentication every worker tier's ScaledObject names (`hatchet-queue-auth.ts`). */
export const HATCHET_QUEUE_AUTH = "hatchet-queue-auth";

/**
 * Consecutive failed polls after which KEDA stops trusting a trigger and holds
 * the tier at its fallback count. Three polls is 45 s: a restart of Postgres or a
 * rotated scaler password is not a fallback, a dead scaler is.
 */
export const SCALER_FALLBACK_FAILURES = 3;

/**
 * KEDA's `cooldownPeriod`. It governs ONE step only: how long after the last
 * active trigger a tier is held before it is taken from 1 replica to 0, so it
 * does nothing where `minReplicas` is 1 (prod). Every step from N down to 1 is
 * the HPA's, and `QUEUE_SCALE_BEHAVIOR.scaleDown` is what slows it. It is long so
 * that a burst arriving in waves does not pay a cold start (an agent-runtime build, a Next
 * boot) per wave.
 */
export const SCALER_COOLDOWN_SECONDS = 300;

/**
 * KEDA's measure of a worker tier's work on Hatchet (ADR-0150): every run of
 * `workflow` waiting for a worker slot (`v1_queue_item`) or held by a worker
 * (`v1_task_runtime`), in this stack's Hatchet namespace. Counting held runs
 * keeps a tier from scaling in underneath the runs it is executing. A run held
 * back by its organisation's concurrency limit is in neither table, so it asks
 * for no replica it could not use. The SDKs name an action
 * `<namespace>_<workflow>:<task>`, lower-cased, so a prefix match covers every
 * task of the workflow; `starts_with` because `_` is a LIKE wildcard. The
 * tables and columns are Hatchet's (`SCALER_COLUMNS`, `background-work-pg.ts`),
 * read through the read-only scaler login.
 */
export function hatchetBacklogQuery(namespace: string, workflow: string): string {
  const prefix = `${namespace}_${workflow}:`.toLowerCase().replace(/'/g, "''");
  return (
    `SELECT (SELECT COUNT(*) FROM v1_queue_item WHERE starts_with(action_id, '${prefix}')) + ` +
    "(SELECT COUNT(*) FROM v1_task_runtime r JOIN v1_task t ON t.id = r.task_id AND t.inserted_at = r.task_inserted_at " +
    `WHERE starts_with(t.action_id, '${prefix}'))`
  );
}

/**
 * Out fast (the backlog is real), in slowly and a pod at a time: each pod that
 * leaves drains for up to its tier's `drainSeconds`.
 */
export const QUEUE_SCALE_BEHAVIOR = {
  scaleUp: { stabilizationWindowSeconds: 0, policies: [{ type: "Percent", value: 100, periodSeconds: 30 }] },
  scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] },
} as const;

/**
 * The count a queue tier is held at while it cannot see its queue: a third of its
 * ceiling, never below its floor or one replica, never above the ceiling. Blind,
 * the backlog is unknown. The floor is too few for a backlog that built up
 * unseen; the ceiling is the whole bill and the provider key's load for a queue
 * that may be empty, so a third is a tier that keeps working and does not run
 * away.
 */
export function fallbackReplicas(minReplicas: number, maxReplicas: number): number {
  return Math.min(maxReplicas, Math.max(1, minReplicas, Math.ceil(maxReplicas / 3)));
}

/**
 * The `fallback` block of a ScaledObject whose triggers KEDA can fall back on.
 *
 * `currentReplicasIfHigher`, not the default `static`: a tier that is already
 * above the fallback count when the trigger goes blind keeps its replicas rather
 * than being scaled down underneath the jobs it is running, and one below it is
 * raised to it.
 *
 * KEDA honours `fallback` only for AverageValue triggers and refuses it beside a
 * `cpu` trigger, which is why the chat tier has none (`backend-scaling.ts`).
 */
export function scalerFallback(minReplicas: number, maxReplicas: number) {
  return {
    failureThreshold: SCALER_FALLBACK_FAILURES,
    replicas: fallbackReplicas(minReplicas, maxReplicas),
    behavior: "currentReplicasIfHigher",
  } as const;
}

/**
 * A TriggerAuthentication that hands one key of a Secret to a trigger as
 * `parameter`. The operator reads the Secret itself, so a rotation reaches it
 * with no pod to restart, and no credential is written into a ScaledObject.
 */
export function installTriggerAuth(
  w: AppWiring,
  opts: {
    name: string;
    /** The trigger parameter the value fills: `connection` (postgresql) or `apiKey` (metrics-api). */
    parameter: "connection" | "apiKey";
    /** The Secret, and its key, that fill it. */
    secretName: string;
    key: string;
    labels: pulumi.Input<Record<string, string>>;
    dependsOn: pulumi.Resource[];
  },
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    opts.name,
    {
      apiVersion: "keda.sh/v1alpha1",
      kind: "TriggerAuthentication",
      metadata: { name: opts.name, namespace: w.namespace, labels: opts.labels },
      spec: { secretTargetRef: [{ parameter: opts.parameter, name: opts.secretName, key: opts.key }] },
    },
    { provider: w.provider, dependsOn: opts.dependsOn },
  );
}

/** KEDA's annotation for adopting an HPA that already scales the workload (KEDA >= 2.12). */
export const TRANSFER_HPA_OWNERSHIP = "scaledobject.keda.sh/transfer-hpa-ownership";

export interface QueueScaledTier {
  /** Name of the ScaledObject; the Deployment it moves has the same name. */
  name: string;
  deployment: k8s.apps.v1.Deployment;
  labels: pulumi.Input<Record<string, string>>;
  minReplicas: number;
  maxReplicas: number;
  /** Runs one replica executes at once: the trigger's target, so replicas = ceil(backlog / concurrency). */
  concurrency: number;
  /** The Hatchet workflow whose backlog the trigger counts (`hatchetBacklogQuery`). */
  workflow: string;
  /**
   * An HPA of this name that a stack may still hold from before the tier moved
   * to KEDA, for the ScaledObject to take over (`transfer-hpa-ownership`).
   *
   * Pulumi creates the ScaledObject before it deletes a resource the program
   * dropped, and KEDA's admission webhook refuses a ScaledObject whose workload
   * another HPA already scales. Without the takeover the update fails at the
   * ScaledObject, the old HPA is never deleted, and every later deploy fails the
   * same way. With it KEDA adopts the HPA under this name. Pulumi's delete of
   * its old record then never completes, because KEDA recreates the object
   * before the provider starts watching, so each stack needs that record
   * dropped from state once by hand (`docs/contributing/gotchas.md`). On a
   * stack without that HPA the annotation is inert.
   */
  adoptHpa?: string;
  dependsOn: pulumi.Resource[];
}

/**
 * The ScaledObject of a worker pool that runs a Hatchet workflow (ADR-0150): one
 * `postgresql` trigger counting the workflow's backlog in `background-work-pg`
 * as the read-only scaler login, one replica per `concurrency` open runs
 * between the tier's floor and ceiling.
 *
 * The Deployment keeps `ignoreChanges: ["spec.replicas"]` at its own definition,
 * because KEDA owns the count once this exists.
 */
export function installQueueScaledObject(w: AppWiring, tier: QueueScaledTier): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    tier.name,
    {
      apiVersion: "keda.sh/v1alpha1",
      kind: "ScaledObject",
      metadata: {
        name: tier.name,
        namespace: w.namespace,
        labels: tier.labels,
        ...(tier.adoptHpa ? { annotations: { [TRANSFER_HPA_OWNERSHIP]: "true" } } : {}),
      },
      spec: {
        scaleTargetRef: { name: tier.deployment.metadata.name },
        minReplicaCount: tier.minReplicas,
        maxReplicaCount: tier.maxReplicas,
        pollingInterval: SCALER_POLLING_SECONDS,
        cooldownPeriod: SCALER_COOLDOWN_SECONDS,
        fallback: scalerFallback(tier.minReplicas, tier.maxReplicas),
        advanced: {
          horizontalPodAutoscalerConfig: {
            ...(tier.adoptHpa ? { name: tier.adoptHpa } : {}),
            behavior: QUEUE_SCALE_BEHAVIOR,
          },
        },
        triggers: [
          {
            type: "postgresql",
            // AverageValue is the type `fallback` requires, and the one that
            // reads as "open jobs per replica"; spelled out because it is a
            // default of the scaler that a version could change.
            metricType: "AverageValue",
            metadata: {
              query: hatchetBacklogQuery(hatchetNamespace(), tier.workflow),
              targetQueryValue: String(tier.concurrency),
              activationTargetQueryValue: "0",
            },
            authenticationRef: { name: HATCHET_QUEUE_AUTH },
          },
        ],
      },
    },
    { provider: w.provider, dependsOn: [tier.deployment, ...tier.dependsOn] },
  );
}
