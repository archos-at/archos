import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels } from "./namespaces";
import { objectName } from "../names";

export const WORKLOAD_ALERT_RULES = "workload-alert-rules";

export const UNAVAILABLE_FOR_MINUTES = 15;

export function workloadAlertRules(namespace: string): string {
  const expr =
    `kube_deployment_spec_replicas{namespace="${namespace}"} > 0` +
    ` and kube_deployment_status_replicas_available{namespace="${namespace}"} == 0`;
  return `# Rendered by deploy/pulumi/src/platform/workload-alerts.ts. Edit there, not here.
groups:
  - name: workloads
    rules:
      - alert: DeploymentUnavailable
        expr: ${JSON.stringify(expr)}
        for: ${UNAVAILABLE_FOR_MINUTES}m
        labels:
          severity: critical
        annotations:
          summary: ${JSON.stringify("Deployment {{ $labels.deployment }} has had no available replica for " + UNAVAILABLE_FOR_MINUTES + " minutes")}
          check: ${JSON.stringify(`kubectl -n ${namespace} get pods -o wide && kubectl -n ${namespace} describe deploy/<deployment>`)}
`;
}

export function installWorkloadAlerts(
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): k8s.core.v1.ConfigMap {
  return new k8s.core.v1.ConfigMap(
    WORKLOAD_ALERT_RULES,
    {
      metadata: { name: WORKLOAD_ALERT_RULES, namespace, labels: commonLabels("workload-alerts") },
      data: { "workload.rules.yaml": workloadAlertRules(objectName("namespace")) },
    },
    { provider },
  );
}
