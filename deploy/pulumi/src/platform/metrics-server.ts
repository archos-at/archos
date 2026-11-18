import * as k8s from "@pulumi/kubernetes";
import { PLATFORM_RESOURCES } from "../constants";
import { scaledCpuRequest } from "../config/cpu-requests";

export const METRICS_SERVER_CHART_VERSION = "3.14.0";

export function installMetricsServer(provider: k8s.Provider): k8s.helm.v3.Release {
  return new k8s.helm.v3.Release(
    "metrics-server",
    {
      chart: "metrics-server",
      version: METRICS_SERVER_CHART_VERSION,
      namespace: "kube-system",
      repositoryOpts: { repo: "https://kubernetes-sigs.github.io/metrics-server/" },
      values: {
        args: ["--kubelet-insecure-tls"],
        resources: scaledCpuRequest(PLATFORM_RESOURCES.metricsServer),
      },
    },
    { provider },
  );
}
