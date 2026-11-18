import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { NODE_GROUP_LABEL } from "../constants";

export function spreadAcrossNodes(
  matchLabels: pulumi.Input<{ [k: string]: string }>,
  required = false,
): k8s.types.input.core.v1.TopologySpreadConstraint[] {
  return [
    {
      maxSkew: 1,
      topologyKey: "kubernetes.io/hostname",
      whenUnsatisfiable: required ? "DoNotSchedule" : "ScheduleAnyway",
      labelSelector: { matchLabels },
    },
  ];
}

export function onNodeGroup(group: string | undefined): { nodeSelector?: { [k: string]: string } } {
  return group ? { nodeSelector: { [NODE_GROUP_LABEL]: group } } : {};
}

export function installPdb(
  name: string,
  namespace: pulumi.Input<string>,
  provider: k8s.Provider,
  matchLabels: pulumi.Input<{ [k: string]: string }>,
  dependsOn: pulumi.Resource[] = [],
): k8s.policy.v1.PodDisruptionBudget {
  return new k8s.policy.v1.PodDisruptionBudget(
    name,
    {
      metadata: { name, namespace },
      spec: {
        maxUnavailable: 1,
        selector: { matchLabels },
      },
    },
    { provider, dependsOn },
  );
}
