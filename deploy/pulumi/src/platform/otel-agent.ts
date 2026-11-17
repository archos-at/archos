import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { commonLabels } from "./namespaces";
import { ROLLOUT, gracefulShutdown, secretChecksum, secretChecksumAnnotations } from "./rollout";
import { NODE_AGENT_RULES, installCollectorIdentity } from "./collector-identity";
import { SCRAPE_ANNOTATION } from "./scrape";
import {
  CollectorFragment,
  HEALTH_PORT,
  OTLP_HTTP_PORT,
  boundedDelivery,
  composeCollectorConfig,
  renderCollectorConfig,
} from "./collector-config";

const COMPONENT = "otel-agent";
const KUBELET_PORT = 10250;
const SCRAPE_INTERVAL = "30s";
const GATEWAY_EXPORTER = "otlp_http/gateway";
const KUBELET_RECEIVER = "kubelet_stats";

export interface OtelAgent {
  daemonSet: k8s.apps.v1.DaemonSet;
  configMap: k8s.core.v1.ConfigMap;
}

export function installOtelAgent(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): OtelAgent {
  const labels = commonLabels(COMPONENT);
  const identity = installCollectorIdentity(COMPONENT, NODE_AGENT_RULES, provider, namespace);
  const config = renderCollectorConfig(
    composeCollectorConfig([nodeStats(), annotatedPods(), toGateway()], { otlpReceiver: false }),
  );

  const configMap = new k8s.core.v1.ConfigMap(
    COMPONENT,
    { metadata: { name: `${COMPONENT}-config`, namespace, labels }, data: { "collector.yaml": config } },
    { provider },
  );

  const daemonSet = new k8s.apps.v1.DaemonSet(
    COMPONENT,
    {
      metadata: { name: COMPONENT, namespace, labels },
      spec: {
        selector: { matchLabels: labels },
        updateStrategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } },
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(secretChecksum({ "collector.yaml": config })),
          },
          spec: {
            enableServiceLinks: false,
            serviceAccountName: identity.serviceAccount.metadata.name,
            automountServiceAccountToken: true,
            securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001 },
            terminationGracePeriodSeconds: gracefulShutdown(ROLLOUT.observability).terminationGracePeriodSeconds,
            tolerations: [{ operator: "Exists" }],
            containers: [
              {
                name: "collector",
                image: cfg.observability.collectorImage,
                imagePullPolicy: "IfNotPresent",
                args: ["--config=/etc/otelcol/collector.yaml"],
                ports: [{ containerPort: HEALTH_PORT, name: "health" }],
                env: [
                  { name: "K8S_NODE_NAME", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } },
                  { name: "K8S_NODE_IP", valueFrom: { fieldRef: { fieldPath: "status.hostIP" } } },
                ],
                volumeMounts: [{ name: "config", mountPath: "/etc/otelcol", readOnly: true }],
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits: { cpu: "250m", memory: "256Mi" },
                },
                readinessProbe: { httpGet: { path: "/", port: HEALTH_PORT }, periodSeconds: 10, timeoutSeconds: 5 },
                livenessProbe: {
                  httpGet: { path: "/", port: HEALTH_PORT },
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                  failureThreshold: 6,
                },
              },
            ],
            volumes: [{ name: "config", configMap: { name: configMap.metadata.name } }],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configMap, identity.binding] },
  );

  return { daemonSet, configMap };
}

export function nodeStats(): CollectorFragment {
  return {
    receivers: {
      [KUBELET_RECEIVER]: {
        auth_type: "serviceAccount",
        endpoint: `https://\${env:K8S_NODE_IP}:${KUBELET_PORT}`,
        insecure_skip_verify: true,
        collection_interval: SCRAPE_INTERVAL,
        metric_groups: ["node", "pod", "container", "volume"],
      },
    },
    pipelines: { "metrics/node": { receivers: [KUBELET_RECEIVER], exporters: [GATEWAY_EXPORTER] } },
  };
}

export function annotatedPods(): CollectorFragment {
  const meta = (annotation: string) =>
    `__meta_kubernetes_pod_annotation_${annotation.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return {
    receivers: {
      "prometheus/pods": {
        config: {
          scrape_configs: [
            {
              job_name: "kubernetes-pods",
              scrape_interval: SCRAPE_INTERVAL,
              scrape_timeout: "10s",
              kubernetes_sd_configs: [
                { role: "pod", selectors: [{ role: "pod", field: "spec.nodeName=${env:K8S_NODE_NAME}" }] },
              ],
              relabel_configs: [
                { source_labels: [meta(SCRAPE_ANNOTATION.scrape)], action: "keep", regex: "true" },
                { source_labels: ["__meta_kubernetes_pod_phase"], action: "keep", regex: "Running" },
                {
                  source_labels: ["__meta_kubernetes_pod_container_port_number"],
                  action: "keepequal",
                  target_label: meta(SCRAPE_ANNOTATION.port),
                },
                {
                  source_labels: [meta(SCRAPE_ANNOTATION.path)],
                  action: "replace",
                  regex: "(.+)",
                  target_label: "__metrics_path__",
                },
                { source_labels: ["__meta_kubernetes_namespace"], target_label: "k8s_namespace_name" },
                { source_labels: ["__meta_kubernetes_pod_name"], target_label: "k8s_pod_name" },
                { source_labels: ["__meta_kubernetes_pod_container_name"], target_label: "k8s_container_name" },
                {
                  source_labels: ["__meta_kubernetes_pod_label_app_kubernetes_io_name"],
                  regex: "(.+)",
                  target_label: "job",
                },
              ],
            },
          ],
        },
      },
    },
    pipelines: { "metrics/pods": { receivers: ["prometheus/pods"], exporters: [GATEWAY_EXPORTER] } },
  };
}

export function toGateway(): CollectorFragment {
  return {
    exporters: {
      [GATEWAY_EXPORTER]: {
        endpoint: `http://otel-collector:${OTLP_HTTP_PORT}`,
        compression: "gzip",
        ...boundedDelivery(500),
      },
    },
  };
}
