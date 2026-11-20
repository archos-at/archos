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

export const POD_METADATA_RULES: ReadRule[] = [
  { apiGroups: [""], resources: ["namespaces", "pods"] },
  { apiGroups: ["apps"], resources: ["replicasets"] },
];

export const EVENT_RULES: ReadRule[] = [{ apiGroups: ["events.k8s.io"], resources: ["events"] }];

export interface CollectorIdentity {
  serviceAccount: k8s.core.v1.ServiceAccount;
  bindings: pulumi.Resource[];
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
  if (rules.length === 0) return { serviceAccount, bindings: [] };
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
  return { serviceAccount, bindings: [binding] };
}

export function grantInNamespaces(
  component: string,
  rules: ReadRule[],
  identity: CollectorIdentity,
  namespaces: string[],
  provider: k8s.Provider,
  dependsOn: pulumi.Resource[],
): k8s.rbac.v1.RoleBinding[] {
  const labels = commonLabels(component);
  return namespaces.map((ns) => {
    const role = new k8s.rbac.v1.Role(
      `${component}-${ns}`,
      {
        metadata: { name: component, namespace: ns, labels },
        rules: rules.map((rule) => ({ ...rule, verbs: READ_VERBS })),
      },
      { provider, dependsOn },
    );
    return new k8s.rbac.v1.RoleBinding(
      `${component}-${ns}`,
      {
        metadata: { name: component, namespace: ns, labels },
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: role.metadata.name },
        subjects: [
          { kind: "ServiceAccount", name: identity.serviceAccount.metadata.name, namespace: identity.serviceAccount.metadata.namespace },
        ],
      },
      { provider, dependsOn },
    );
  });
}
