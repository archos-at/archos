import * as k8s from "@pulumi/kubernetes";
import { PLATFORM_RESOURCES } from "../constants";
import { scrapeAnnotations } from "./scrape";

export const KEDA_NAMESPACE = "keda";

export const KEDA_CHART_VERSION = "2.21.0";

export const KEDA_OPERATOR_LABEL = { "app.kubernetes.io/name": "keda-operator" } as const;
const KEDA_OPERATOR_METRICS_PORT = 8080;

export function installKeda(provider: k8s.Provider): k8s.helm.v3.Release {
  const ns = new k8s.core.v1.Namespace("keda-ns", { metadata: { name: KEDA_NAMESPACE } }, { provider });
  return new k8s.helm.v3.Release(
    "keda",
    {
      chart: "keda",
      version: KEDA_CHART_VERSION,
      namespace: ns.metadata.name,
      repositoryOpts: { repo: "https://kedacore.github.io/charts" },
      values: {
        resources: {
          operator: PLATFORM_RESOURCES.kedaOperator,
          metricServer: PLATFORM_RESOURCES.kedaMetricServer,
          webhooks: PLATFORM_RESOURCES.kedaWebhooks,
        },
        prometheus: { operator: { enabled: true, port: KEDA_OPERATOR_METRICS_PORT } },
        podAnnotations: { keda: scrapeAnnotations(KEDA_OPERATOR_METRICS_PORT) },
      },
    },
    { provider, dependsOn: [ns] },
  );
}
