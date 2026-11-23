import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { commonLabels } from "../platform/namespaces";
import { AppWiring, SECRET_NAME } from "./config";
import { SCALER_POLLING_SECONDS, installTriggerAuth } from "./keda-scaling";
import { PORT } from "../constants";
import { CHAT_TIER } from "./tier-names";
import { cpuUtilizationTarget } from "../config/cpu-requests";

export const OCCUPANCY_PATH = "/v1/internal/chat-occupancy";

export const OCCUPANCY_FIELD = "activeTurns";

export const OCCUPANCY_TOKEN_HEADER = "x-internal-token";

export function occupancyUrl(namespace: pulumi.Input<string>, tier: string = CHAT_TIER): pulumi.Output<string> {
  return pulumi.interpolate`http://${tier}.${namespace}.svc.cluster.local:${PORT.backend}${OCCUPANCY_PATH}`;
}

export function installBackendScaling(
  w: AppWiring,
  cfg: DeployConfig,
  statefulSet: k8s.apps.v1.StatefulSet,
  dependsOn: pulumi.Resource[],
  name: string = CHAT_TIER,
): { scaledObject: k8s.apiextensions.CustomResource; auth: k8s.apiextensions.CustomResource } {
  const labels = commonLabels(name);

  const auth = installTriggerAuth(w, {
    name: `${name}-occupancy-auth`,
    parameter: "apiKey",
    secretName: SECRET_NAME,
    key: "INTERNAL_API_TOKEN",
    labels,
    dependsOn,
  });

  const scaledObject = new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: "keda.sh/v1alpha1",
      kind: "ScaledObject",
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        scaleTargetRef: { apiVersion: "apps/v1", kind: "StatefulSet", name: statefulSet.metadata.name },
        minReplicaCount: cfg.backend.replicas,
        maxReplicaCount: cfg.backend.maxReplicas,
        pollingInterval: SCALER_POLLING_SECONDS,
        advanced: {
          horizontalPodAutoscalerConfig: {
            behavior: {
              scaleUp: { stabilizationWindowSeconds: 0, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] },
              scaleDown: {
                stabilizationWindowSeconds: 900,
                policies: [{ type: "Pods", value: 1, periodSeconds: 300 }],
              },
            },
          },
        },
        triggers: [
          {
            type: "metrics-api",
            metricType: "AverageValue",
            metadata: {
              url: occupancyUrl(w.namespace, name),
              valueLocation: OCCUPANCY_FIELD,
              targetValue: String(cfg.backend.turnsPerReplica),
              authMode: "apiKey",
              method: "header",
              keyParamName: OCCUPANCY_TOKEN_HEADER,
            },
            authenticationRef: { name: auth.metadata.name },
          },
          {
            type: "cpu",
            metricType: "Utilization",
            metadata: { value: String(cpuUtilizationTarget(cfg.backend.cpuTargetPercent)) },
          },
        ],
      },
    },
    { provider: w.provider, dependsOn: [statefulSet, auth, ...dependsOn] },
  );

  return { scaledObject, auth };
}
