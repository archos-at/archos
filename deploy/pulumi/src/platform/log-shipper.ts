import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { LOG_SHIPPER, LOG_SOURCE, LOG_SOURCE_ATTRIBUTE } from "../config/observability";
import { commonLabels } from "./namespaces";
import { ROLLOUT, gracefulShutdown, secretChecksum, secretChecksumAnnotations } from "./rollout";
import { POD_METADATA_RULES, installCollectorIdentity } from "./collector-identity";
import { hardenedContainerSecurityContext } from "./security";
import { BACKFILL_POD } from "../constants";
import {
  CollectorFragment,
  HEALTH_PORT,
  SHIPPER_OTLP_PORT,
  composeCollectorConfig,
  renderCollectorConfig,
} from "./collector-config";
import { GATEWAY_EXPORTER, toGateway } from "./otel-agent";

const COMPONENT = LOG_SHIPPER.name;
const POD_LOGS = "filelog/pods";
const SEVERITY = "SEVERITY_NUMBER";

export interface LogShipper {
  namespace: k8s.core.v1.Namespace;
  daemonSet: k8s.apps.v1.DaemonSet;
  configMap: k8s.core.v1.ConfigMap;
}

export function installLogShipper(
  cfg: DeployConfig,
  provider: k8s.Provider,
  readNamespaces: string[],
  dependsOn: pulumi.Resource[],
): LogShipper {
  const labels = commonLabels(COMPONENT);
  const namespace = new k8s.core.v1.Namespace(
    "observability-ns",
    {
      metadata: {
        name: LOG_SHIPPER.namespace,
        labels: {
          ...(commonLabels("observability") as Record<string, string>),
          "pod-security.kubernetes.io/enforce": "privileged",
          "pod-security.kubernetes.io/warn": "baseline",
          "pod-security.kubernetes.io/audit": "baseline",
        },
      },
    },
    { provider },
  );
  const ns = namespace.metadata.name;
  const identity = installCollectorIdentity(COMPONENT, POD_METADATA_RULES, provider, ns);
  const config = renderCollectorConfig(
    composeCollectorConfig([podLogs(readNamespaces), toGateway(`otel-collector.${cfg.namespace}.svc`, SHIPPER_OTLP_PORT)], {
      otlpReceiver: false,
    }),
  );

  const configMap = new k8s.core.v1.ConfigMap(
    COMPONENT,
    { metadata: { name: `${COMPONENT}-config`, namespace: ns, labels }, data: { "collector.yaml": config } },
    { provider },
  );

  const daemonSet = new k8s.apps.v1.DaemonSet(
    COMPONENT,
    {
      metadata: { name: COMPONENT, namespace: ns, labels },
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
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 10001,
              runAsGroup: 10001,
              supplementalGroups: [0],
              seccompProfile: { type: "RuntimeDefault" },
            },
            terminationGracePeriodSeconds: gracefulShutdown(ROLLOUT.observability).terminationGracePeriodSeconds,
            tolerations: [{ operator: "Exists" }],
            containers: [
              {
                name: "collector",
                image: cfg.observability.collectorImage,
                imagePullPolicy: "IfNotPresent",
                args: ["--config=/etc/otelcol/collector.yaml"],
                ports: [{ containerPort: HEALTH_PORT, name: "health" }],
                env: [{ name: "K8S_NODE_NAME", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } }],
                securityContext: { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true },
                volumeMounts: [
                  { name: "config", mountPath: "/etc/otelcol", readOnly: true },
                  { name: "pod-logs", mountPath: LOG_SHIPPER.podLogDir, readOnly: true },
                ],
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits: { cpu: "250m", memory: "192Mi" },
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
            volumes: [
              { name: "config", configMap: { name: configMap.metadata.name } },
              { name: "pod-logs", hostPath: { path: LOG_SHIPPER.podLogDir, type: "Directory" } },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configMap, ...identity.bindings] },
  );

  return { namespace, daemonSet, configMap };
}

export function podLogGlobs(readNamespaces: string[]): { include: string[]; exclude: string[] } {
  const dir = LOG_SHIPPER.podLogDir;
  const skipped = [...LOG_SHIPPER.otlpInstrumentedContainers, ...LOG_SHIPPER.ownContainers, ...LOG_SHIPPER.noisyContainers];
  return {
    include: readNamespaces.map((ns) => `${dir}/${ns}_*/*/*.log`),
    exclude: skipped.map((container) => `${dir}/*/${container}/*.log`),
  };
}

const ottl = (pattern: string) => JSON.stringify(pattern);
const bodyMatches = (pattern: string) => `IsString(log.body) and IsMatch(log.body, ${ottl(pattern)})`;

const LEVEL_PREFIX = String.raw`^[^a-z]{0,48}?\[?`;

export const UNSAMPLED_POD = String.raw`^${BACKFILL_POD}-`;

export const LEVEL_PATTERNS = {
  debug: String.raw`(?i:level"?[=:]\s*"?(debug|trace)\b)|${LEVEL_PREFIX}(DEBUG|TRACE)\b|"level":\s*(10|20)\b`,
  warn: String.raw`(?i:level"?[=:]\s*"?warn)|${LEVEL_PREFIX}WARN(ING)?\b|"level":\s*40\b`,
  error: String.raw`(?i:level"?[=:]\s*"?(error|fatal|crit|panic))|\b(ERROR|FATAL|CRITICAL|PANIC)\b|Traceback|Exception\b|Error:|panic:|"level":\s*(50|60)\b`,
};

export function podLogs(readNamespaces: string[]): CollectorFragment {
  const { include, exclude } = podLogGlobs(readNamespaces);
  return {
    receivers: {
      [POD_LOGS]: {
        include,
        exclude,
        start_at: "end",
        include_file_path: true,
        include_file_name: false,
        max_log_size: `${LOG_SHIPPER.maxLineBytes / 1024}KiB`,
        operators: [
          { type: "container", id: "container-parser", add_metadata_from_filepath: true },
        ],
      },
    },
    processors: {
      "transform/pod_logs": {
        error_mode: "ignore",
        log_statements: [
          {
            context: "resource",
            statements: [
              `set(resource.attributes["service.name"], resource.attributes["k8s.container.name"])`,
              `set(resource.attributes["${LOG_SOURCE_ATTRIBUTE}"], "${LOG_SOURCE.container}")`,
            ],
          },
          {
            context: "log",
            statements: [
              `delete_key(log.attributes, "log.file.path")`,
              `set(log.body, Substring(log.body, 0, ${LOG_SHIPPER.maxLineBytes})) where IsString(log.body) and Len(log.body) > ${LOG_SHIPPER.maxLineBytes}`,
              `set(log.severity_number, ${SEVERITY}_INFO)`,
              `set(log.severity_number, ${SEVERITY}_WARN) where log.attributes["log.iostream"] == "stderr"`,
              `set(log.severity_number, ${SEVERITY}_DEBUG) where ${bodyMatches(LEVEL_PATTERNS.debug)}`,
              `set(log.severity_number, ${SEVERITY}_WARN) where ${bodyMatches(LEVEL_PATTERNS.warn)}`,
              `set(log.severity_number, ${SEVERITY}_ERROR) where ${bodyMatches(LEVEL_PATTERNS.error)}`,
              `set(log.severity_text, "debug") where log.severity_number == ${SEVERITY}_DEBUG`,
              `set(log.severity_text, "info") where log.severity_number == ${SEVERITY}_INFO`,
              `set(log.severity_text, "warn") where log.severity_number == ${SEVERITY}_WARN`,
              `set(log.severity_text, "error") where log.severity_number == ${SEVERITY}_ERROR`,
              `set(log.attributes["sampling.key"], UUID())`,
              `set(log.attributes["sampling.priority"], 100) where log.severity_number >= ${SEVERITY}_WARN`,
              `set(log.attributes["sampling.priority"], 100) where IsMatch(resource.attributes["k8s.pod.name"], ${ottl(UNSAMPLED_POD)})`,
            ],
          },
        ],
      },
      "filter/drop_debug": { error_mode: "ignore", log_conditions: [`log.severity_number < ${SEVERITY}_INFO`] },
      "probabilistic_sampler/info": {
        mode: "hash_seed",
        sampling_percentage: LOG_SHIPPER.infoSamplePercent,
        attribute_source: "record",
        from_attribute: "sampling.key",
        sampling_priority: "sampling.priority",
      },
      "transform/drop_sampling_keys": {
        error_mode: "ignore",
        log_statements: [
          {
            context: "log",
            statements: [`delete_key(log.attributes, "sampling.key")`, `delete_key(log.attributes, "sampling.priority")`],
          },
        ],
      },
      k8sattributes: {
        auth_type: "serviceAccount",
        filter: { node_from_env_var: "K8S_NODE_NAME" },
        pod_association: [{ sources: [{ from: "resource_attribute", name: "k8s.pod.uid" }] }],
        extract: { metadata: ["k8s.deployment.name", "k8s.statefulset.name", "k8s.job.name", "k8s.node.name"] },
      },
    },
    pipelines: {
      "logs/pods": {
        receivers: [POD_LOGS],
        processors: [
          "transform/pod_logs",
          "filter/drop_debug",
          "probabilistic_sampler/info",
          "transform/drop_sampling_keys",
          "k8sattributes",
        ],
        exporters: [GATEWAY_EXPORTER],
      },
    },
  };
}
