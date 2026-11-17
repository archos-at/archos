import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { logicalName, objectName } from "../names";

export function makeAppNamespace(
  cfg: DeployConfig,
  provider: k8s.Provider,
): k8s.core.v1.Namespace {
  return new k8s.core.v1.Namespace(
    logicalName("grid-ns"),
    {
      metadata: {
        name: cfg.namespace,
        labels: {
          "app.kubernetes.io/part-of": objectName("partOf"),
          "pod-security.kubernetes.io/enforce": "baseline",
        },
      },
    },
    { provider },
  );
}

export function commonLabels(component: string): pulumi.Input<{ [k: string]: string }> {
  return {
    "app.kubernetes.io/name": component,
    "app.kubernetes.io/part-of": objectName("partOf"),
    "app.kubernetes.io/managed-by": "pulumi",
  };
}
