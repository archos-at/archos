import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { BACKGROUND_WORK } from "../config/background-work";
import { commonLabels } from "./namespaces";
import { RABBITMQ } from "./rabbitmq";

/**
 * Prometheus alerting rules for the background-work platform (ADR-0150), as
 * the `background-work-alert-rules` ConfigMap, on the terms of
 * `workload-alerts.ts`: this repo evaluates no rules, the file is what an
 * evaluator is pointed at. The series come from two places: kube-state-metrics
 * (the managed agent on the cluster) for the RabbitMQ StatefulSet, and the node
 * agents' scrape (ADR-0119) of `rabbitmq_prometheus` and Hatchet's engine,
 * labelled `k8s_namespace_name` by `otel-agent.ts`.
 */

export const BACKGROUND_WORK_ALERT_RULES = "background-work-alert-rules";

export const BACKGROUND_WORK_ALERT_THRESHOLDS = {
  /** Messages ready in RabbitMQ for this long means Hatchet's controllers stopped consuming. */
  queueDepth: 1000,
  queueDepthMinutes: 15,
  /** A RabbitMQ node missing this long: one more and the quorum is gone. */
  nodeDownMinutes: 5,
  /** p95 seconds a task waits between queued and assigned: workers too few, or the scheduler behind. */
  schedulingLagSeconds: 300,
} as const;

/** The rule file, in Prometheus' `groups:` format. Exported for the spec. */
export function backgroundWorkAlertRules(): string {
  const t = BACKGROUND_WORK_ALERT_THRESHOLDS;
  const ns = BACKGROUND_WORK.namespace;
  const scraped = `k8s_namespace_name="${ns}"`;
  const statefulSet = `${RABBITMQ.cluster}-server`;
  const rules = [
    {
      alert: "RabbitmqNodeUnavailable",
      expr: `kube_statefulset_status_replicas_ready{namespace="${ns}",statefulset="${statefulSet}"} < ${RABBITMQ.replicas}`,
      for: `${t.nodeDownMinutes}m`,
      severity: "critical",
      summary: `A RabbitMQ node of ${RABBITMQ.cluster} has not been ready for ${t.nodeDownMinutes} minutes; one more loses the quorum`,
      check: `kubectl -n ${ns} get pods -l background-work/component=rabbitmq -o wide && kubectl -n ${ns} get rabbitmqcluster ${RABBITMQ.cluster}`,
    },
    {
      alert: "RabbitmqQueueDepth",
      expr: `sum(rabbitmq_queue_messages_ready{${scraped}}) > ${t.queueDepth}`,
      for: `${t.queueDepthMinutes}m`,
      severity: "warning",
      summary: `More than ${t.queueDepth} messages have waited in Hatchet's RabbitMQ for ${t.queueDepthMinutes} minutes`,
      check: `kubectl -n ${ns} exec ${statefulSet}-0 -- rabbitmqctl list_queues name messages_ready consumers`,
    },
    {
      alert: "HatchetSchedulingLag",
      expr:
        `histogram_quantile(0.95, sum by (le) (rate(hatchet_queued_to_assigned_time_seconds_bucket{${scraped}}[10m])))` +
        ` > ${t.schedulingLagSeconds}`,
      for: "15m",
      severity: "warning",
      summary: `The 95th percentile wait from queued to assigned has passed ${t.schedulingLagSeconds} s`,
      check: "docs/deployment/hatchet.md, \"What to watch\"",
    },
  ];
  const q = JSON.stringify;
  return [
    "# Rendered by deploy/pulumi/src/platform/background-work-alerts.ts. Edit there, not here.",
    "groups:",
    "  - name: background-work",
    "    rules:",
    ...rules.flatMap((r) => [
      `      - alert: ${r.alert}`,
      `        expr: ${q(r.expr)}`,
      `        for: ${r.for}`,
      "        labels:",
      `          severity: ${r.severity}`,
      "        annotations:",
      `          summary: ${q(r.summary)}`,
      `          check: ${q(r.check)}`,
    ]),
    "",
  ].join("\n");
}

export function installBackgroundWorkAlerts(provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.core.v1.ConfigMap {
  return new k8s.core.v1.ConfigMap(
    BACKGROUND_WORK_ALERT_RULES,
    {
      metadata: { name: BACKGROUND_WORK_ALERT_RULES, namespace: BACKGROUND_WORK.namespace, labels: commonLabels("background-work-alerts") },
      data: { "background-work.rules.yaml": backgroundWorkAlertRules() },
    },
    { provider, dependsOn },
  );
}
