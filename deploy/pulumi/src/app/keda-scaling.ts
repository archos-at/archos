import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { AppWiring } from "./config";
import { hatchetNamespace } from "./hatchet-env";

export const SCALER_POLLING_SECONDS = 15;

export const HATCHET_QUEUE_AUTH = "hatchet-queue-auth";

export const SCALER_FALLBACK_FAILURES = 3;

export const SCALER_COOLDOWN_SECONDS = 300;

export function hatchetBacklogQuery(namespace: string, workflow: string): string {
  const prefix = `${namespace}_${workflow}:`.toLowerCase().replace(/'/g, "''");
  return (
    `SELECT (SELECT COUNT(*) FROM v1_queue_item WHERE starts_with(action_id, '${prefix}')) + ` +
    "(SELECT COUNT(*) FROM v1_task_runtime r JOIN v1_task t ON t.id = r.task_id AND t.inserted_at = r.task_inserted_at " +
    `WHERE starts_with(t.action_id, '${prefix}'))`
  );
}

export const QUEUE_SCALE_BEHAVIOR = {
  scaleUp: { stabilizationWindowSeconds: 0, policies: [{ type: "Percent", value: 100, periodSeconds: 30 }] },
  scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] },
} as const;

export function fallbackReplicas(minReplicas: number, maxReplicas: number): number {
  return Math.min(maxReplicas, Math.max(1, minReplicas, Math.ceil(maxReplicas / 3)));
}

export function scalerFallback(minReplicas: number, maxReplicas: number) {
  return {
    failureThreshold: SCALER_FALLBACK_FAILURES,
    replicas: fallbackReplicas(minReplicas, maxReplicas),
    behavior: "currentReplicasIfHigher",
  } as const;
}

export function installTriggerAuth(
  w: AppWiring,
  opts: {
    name: string;
    parameter: "connection" | "apiKey";
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

export const TRANSFER_HPA_OWNERSHIP = "scaledobject.keda.sh/transfer-hpa-ownership";

export interface QueueScaledTier {
  name: string;
  deployment: k8s.apps.v1.Deployment;
  labels: pulumi.Input<Record<string, string>>;
  minReplicas: number;
  maxReplicas: number;
  concurrency: number;
  workflow: string;
  adoptHpa?: string;
  dependsOn: pulumi.Resource[];
}

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
