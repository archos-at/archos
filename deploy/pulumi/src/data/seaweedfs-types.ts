import * as k8s from "@pulumi/kubernetes";

export interface SeaweedTopology {
  workloads: k8s.apps.v1.StatefulSet[];
  service: k8s.core.v1.Service;
  masterService: k8s.core.v1.Service;
  masterAddress: string;
  filerAddress: string;
  pdbs: k8s.policy.v1.PodDisruptionBudget[];
}
