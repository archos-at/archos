import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels } from "./namespaces";

export type ReadRule = { apiGroups: string[]; resources: string[] };

const READ_VERBS = ["get", "list", "watch"];

export const CLUSTER_STATE_RULES: ReadRule[] = [
  {
    apiGroups: [""],
    resources: [
      "events",
      "namespaces",
      "namespaces/status",
      "nodes",
      "nodes/spec",
      "pods",
      "pods/status",
      "replicationcontrollers",
      "replicationcontrollers/status",
      "resourcequotas",
      "services",
    ],
  },
  { apiGroups: ["apps"], resources: ["daemonsets", "deployments", "replicasets", "statefulsets"] },
  { apiGroups: ["batch"], resources: ["jobs", "cronjobs"] },
  { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"] },
];

export const NODE_AGENT_RULES: ReadRule[] = [{ apiGroups: [""], resources: ["nodes/stats", "pods"] }];

export interface CollectorIdentity {
  serviceAccount: k8s.core.v1.ServiceAccount;
  binding: k8s.rbac.v1.ClusterRoleBinding;
}

export function installCollectorIdentity(
  component: string,
  rules: ReadRule[],
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): CollectorIdentity {
  const labels = commonLabels(component);
  const serviceAccount = new k8s.core.v1.ServiceAccount(
    component,
    { metadata: { name: component, namespace, labels } },
    { provider },
  );
  const roleName = pulumi.interpolate`${namespace}-${component}`;
  const role = new k8s.rbac.v1.ClusterRole(
    component,
    {
      metadata: { name: roleName, labels },
      rules: rules.map((rule) => ({ ...rule, verbs: READ_VERBS })),
    },
    { provider },
  );
  const binding = new k8s.rbac.v1.ClusterRoleBinding(
    component,
    {
      metadata: { name: roleName, labels },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: role.metadata.name },
      subjects: [{ kind: "ServiceAccount", name: serviceAccount.metadata.name, namespace }],
    },
    { provider },
  );
  return { serviceAccount, binding };
}
