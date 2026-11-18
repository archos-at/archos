import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "./scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { commonLabels } from "./namespaces";
import {
  ROLLOUT,
  gracefulShutdown,
  secretChecksum,
  secretChecksumAnnotations,
  surgeRollout,
} from "./rollout";
import {
  LANGFUSE_SECRET_KEYS,
  langfuseOtlpBasicAuth,
  langfuseOtlpTracesEndpoint,
} from "./langfuse";
import {
  CLUSTER_STATE_RULES,
  EVENT_RULES,
  grantInNamespaces,
  installCollectorIdentity,
} from "./collector-identity";
import { LOG_SOURCE, LOG_SOURCE_ATTRIBUTE } from "../config/observability";
import { BFF_SERVICE_NAME } from "../app/config";
import { BFF_JOBS_SERVICE_NAME } from "../app/bff-jobs-env";
import {
  CollectorFragment,
  HEALTH_PORT,
  OTLP_GRPC_PORT,
  OTLP_HTTP_PORT,
  OTLP_RECEIVER,
  SHIPPER_OTLP_PORT,
  boundedDelivery,
  composeCollectorConfig,
  renderCollectorConfig,
} from "./collector-config";

const COMPONENT = "otel-collector";
export const METRICS_EXPORT_PORT = 8889;
const QDRANT_SCRAPE_INTERVAL = "30s";
const CLUSTER_STATE_INTERVAL = "30s";

export interface OtelCollector {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  configMap: k8s.core.v1.ConfigMap;
}

export interface OtelCollectorSources {
  langfuseSecretName?: pulumi.Input<string>;
  qdrantMetricsTargets?: pulumi.Input<string[]>;
  eventNamespaces?: string[];
  eventNamespaceResources?: pulumi.Resource[];
}

export function installOtelCollector(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  sources: OtelCollectorSources = {},
): OtelCollector {
  const labels = commonLabels(COMPONENT);
  const name = COMPONENT;
  const { langfuseSecretName, qdrantMetricsTargets, eventNamespaces = [], eventNamespaceResources = [] } = sources;
  const events = cfg.posthog.logsEnabled && eventNamespaces.length > 0;

  const metrics = cfg.posthog.metricsEnabled;
  const configFor = (qdrant: string[] | undefined): string =>
    renderCollectorConfig(
      composeCollectorConfig([
        ...(langfuseSecretName ? [langfuseTraces()] : []),
        ...(cfg.posthog.tracesEnabled
          ? [posthogTraces(cfg.posthog.host, cfg.posthog.projectToken, pulumi.getStack())]
          : []),
        ...(cfg.posthog.logsEnabled
          ? [posthogLogs(cfg.posthog.host, cfg.posthog.projectToken, pulumi.getStack()), containerLogs()]
          : []),
        ...(events ? [kubernetesEvents(eventNamespaces)] : []),
        ...(qdrant ? [qdrantScrape(qdrant)] : []),
        ...(metrics
          ? [
              clusterState(),
              posthogMetrics(cfg.posthog.host, cfg.posthog.projectToken, pulumi.getStack(), [
                OTLP_RECEIVER,
                CLUSTER_STATE_RECEIVER,
                ...(qdrant ? [QDRANT_RECEIVER] : []),
              ]),
            ]
          : []),
      ]),
    );
  const identity =
    metrics || events
      ? installCollectorIdentity(COMPONENT, metrics ? CLUSTER_STATE_RULES : [], provider, namespace)
      : undefined;
  const eventBindings =
    identity && events
      ? grantInNamespaces(`${COMPONENT}-events`, EVENT_RULES, identity, eventNamespaces, provider, eventNamespaceResources)
      : [];
  const config: pulumi.Input<string> = qdrantMetricsTargets
    ? pulumi.output(qdrantMetricsTargets).apply((targets) => configFor(targets))
    : configFor(undefined);

  const configMap = new k8s.core.v1.ConfigMap(
    COMPONENT,
    {
      metadata: { name: `${COMPONENT}-config`, namespace, labels },
      data: { "collector.yaml": config },
    },
    { provider, dependsOn },
  );

  const deployment = new k8s.apps.v1.Deployment(
    COMPONENT,
    {
      metadata: { name, namespace, labels },
      spec: {
        replicas: 1,
        ...surgeRollout(ROLLOUT.observability),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(
              secretChecksum({
                ...(cfg.langfuse.enabled ? { "langfuse-otlp-auth": langfuseOtlpBasicAuth(cfg) } : {}),
                "collector.yaml": config,
              }),
            ),
          },
          spec: {
            enableServiceLinks: false,
            ...(identity
              ? { serviceAccountName: identity.serviceAccount.metadata.name, automountServiceAccountToken: true }
              : { automountServiceAccountToken: false }),
            securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001 },
            terminationGracePeriodSeconds:
              gracefulShutdown(ROLLOUT.observability).terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "collector",
                image: cfg.observability.collectorImage,
                imagePullPolicy: "IfNotPresent",
                args: ["--config=/etc/otelcol/collector.yaml"],
                ports: [
                  { containerPort: OTLP_GRPC_PORT, name: "otlp-grpc" },
                  { containerPort: OTLP_HTTP_PORT, name: "otlp-http" },
                  ...(cfg.posthog.logsEnabled ? [{ containerPort: SHIPPER_OTLP_PORT, name: "otlp-shipper" }] : []),
                  { containerPort: HEALTH_PORT, name: "health" },
                  ...(qdrantMetricsTargets ? [{ containerPort: METRICS_EXPORT_PORT, name: "metrics" }] : []),
                ],
                env: langfuseSecretName
                  ? [
                      {
                        name: "LANGFUSE_OTLP_AUTH",
                        valueFrom: {
                          secretKeyRef: { name: langfuseSecretName, key: LANGFUSE_SECRET_KEYS.otlpBasicAuth },
                        },
                      },
                    ]
                  : [],
                volumeMounts: [
                  { name: "config", mountPath: "/etc/otelcol", readOnly: true },
                ],
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "512Mi" },
                },
                readinessProbe: {
                  httpGet: { path: "/", port: HEALTH_PORT },
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                },
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
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, configMap, ...(identity?.bindings ?? []), ...eventBindings] },
  );

  const service = new k8s.core.v1.Service(
    COMPONENT,
    {
      metadata: { name, namespace, labels },
      spec: {
        selector: labels,
        ports: [
          { port: OTLP_GRPC_PORT, targetPort: OTLP_GRPC_PORT, name: "otlp-grpc" },
          { port: OTLP_HTTP_PORT, targetPort: OTLP_HTTP_PORT, name: "otlp-http" },
          ...(cfg.posthog.logsEnabled
            ? [{ port: SHIPPER_OTLP_PORT, targetPort: SHIPPER_OTLP_PORT, name: "otlp-shipper" }]
            : []),
          ...(qdrantMetricsTargets
            ? [{ port: METRICS_EXPORT_PORT, targetPort: METRICS_EXPORT_PORT, name: "metrics" }]
            : []),
        ],
      },
    },
    { provider, dependsOn: deployment },
  );

  return { deployment, service, configMap };
}

export const APP_TRACE_SERVICES = [BFF_SERVICE_NAME, BFF_JOBS_SERVICE_NAME] as const;

const URL_ATTRIBUTES = ["http.target", "http.url", "url.full"] as const;

const FROM_APP_TIER = APP_TRACE_SERVICES.map((s) => `resource.attributes["service.name"] == "${s}"`).join(" or ");

export function langfuseTraces(): CollectorFragment {
  return {
    processors: {
      "filter/drop_app_spans": { error_mode: "ignore", trace_conditions: [FROM_APP_TIER] },
    },
    exporters: {
      "otlp_http/langfuse": {
        traces_endpoint: langfuseOtlpTracesEndpoint(),
        headers: {
          Authorization: "${env:LANGFUSE_OTLP_AUTH}",
          "x-langfuse-ingestion-version": "4",
        },
        compression: "gzip",
        ...boundedDelivery(2000),
      },
    },
    pipelines: {
      traces: {
        receivers: [OTLP_RECEIVER],
        processors: ["filter/drop_app_spans"],
        exporters: ["otlp_http/langfuse"],
      },
    },
  };
}

export function posthogTraces(host: string, projectToken: string, environment: string): CollectorFragment {
  return {
    processors: {
      "filter/app_spans_only": { error_mode: "ignore", trace_conditions: [`not (${FROM_APP_TIER})`] },
      "transform/strip_url_queries": {
        error_mode: "ignore",
        trace_statements: URL_ATTRIBUTES.map(
          (key) => `replace_pattern(span.attributes["${key}"], "[?].*$", "")`,
        ),
      },
      "resource/traces_environment": {
        attributes: [{ key: "deployment.environment.name", value: environment, action: "insert" }],
      },
    },
    exporters: {
      "otlp_http/posthog_traces": {
        traces_endpoint: `${host.replace(/\/+$/, "")}/i/v1/traces`,
        headers: { Authorization: `Bearer ${projectToken}` },
        compression: "gzip",
        ...boundedDelivery(1000),
      },
    },
    pipelines: {
      "traces/posthog": {
        receivers: [OTLP_RECEIVER],
        processors: ["filter/app_spans_only", "transform/strip_url_queries", "resource/traces_environment"],
        exporters: ["otlp_http/posthog_traces"],
      },
    },
  };
}

export const WITHHELD = "(text withheld)";

const AREA_TAG = "[[][A-Za-z0-9 _.:/-]{1,48}[]]";

export const POSTHOG_LOG_ATTRIBUTES = [
  "code.function",
  "code.function.name",
  "code.namespace",
  "code.filepath",
  "code.file.path",
  "code.lineno",
  "code.line.number",
  "exception.type",
  "error.type",
  "http.response.status_code",
  "http.status_code",
  "event.name",
] as const;

export const POSTHOG_LOG_REDACTION = {
  error_mode: "propagate",
  log_statements: [
    {
      context: "log",
      statements: [
        `keep_keys(log.attributes, [${POSTHOG_LOG_ATTRIBUTES.map((key) => JSON.stringify(key)).join(", ")}])`,
        `set(log.body, Concat([ExtractPatterns(log.body, "^(?P<tag>${AREA_TAG})")["tag"], "${WITHHELD}"], " ")) where IsString(log.body) and IsMatch(log.body, "^${AREA_TAG}")`,
        `set(log.body, "${WITHHELD}") where not (IsString(log.body) and IsMatch(log.body, "^${AREA_TAG} [(]text withheld[)]$"))`,
      ],
    },
  ],
};

export function posthogLogs(host: string, projectToken: string, environment: string): CollectorFragment {
  return {
    processors: {
      "resource/logs_environment": {
        attributes: [{ key: "deployment.environment.name", value: environment, action: "insert" }],
      },
      "filter/warn_and_above": {
        error_mode: "ignore",
        log_conditions: ["log.severity_number < SEVERITY_NUMBER_WARN"],
      },
      "transform/posthog_redact": POSTHOG_LOG_REDACTION,
    },
    exporters: {
      "otlp_http/posthog": {
        logs_endpoint: `${host.replace(/\/+$/, "")}/i/v1/logs`,
        headers: { Authorization: `Bearer ${projectToken}` },
        compression: "gzip",
        ...boundedDelivery(1000),
      },
    },
    pipelines: {
      "logs/posthog": {
        receivers: [OTLP_RECEIVER],
        processors: ["filter/warn_and_above", "transform/posthog_redact", "resource/logs_environment"],
        exporters: ["otlp_http/posthog"],
      },
    },
  };
}

export const SHIPPER_RECEIVER = "otlp/shipper";

export function containerLogs(): CollectorFragment {
  return {
    receivers: {
      [SHIPPER_RECEIVER]: { protocols: { http: { endpoint: `0.0.0.0:${SHIPPER_OTLP_PORT}` } } },
    },
    processors: {
      "resource/container_source": {
        attributes: [{ key: LOG_SOURCE_ATTRIBUTE, value: LOG_SOURCE.container, action: "upsert" }],
      },
    },
    pipelines: {
      "logs/containers": {
        receivers: [SHIPPER_RECEIVER],
        processors: ["resource/container_source", "resource/logs_environment"],
        exporters: ["otlp_http/posthog"],
      },
    },
  };
}

export const EVENTS_RECEIVER = "k8sobjects/events";

const EVENT = 'log.body["object"]';

export function kubernetesEvents(namespaces: string[]): CollectorFragment {
  return {
    receivers: {
      [EVENTS_RECEIVER]: {
        auth_type: "serviceAccount",
        objects: [{ name: "events", group: "events.k8s.io", mode: "watch", namespaces }],
      },
    },
    processors: {
      "filter/event_deletions": { error_mode: "ignore", log_conditions: ['log.body["type"] == "DELETED"'] },
      "transform/k8s_events": {
        error_mode: "ignore",
        log_statements: [
          {
            context: "log",
            statements: [
              `set(log.attributes["service.name"], "k8s-events")`,
              `set(log.attributes["${LOG_SOURCE_ATTRIBUTE}"], "${LOG_SOURCE.event}")`,
              `set(log.attributes["k8s.namespace.name"], ${EVENT}["regarding"]["namespace"])`,
              `set(log.attributes["k8s.event.reason"], ${EVENT}["reason"])`,
              `set(log.attributes["k8s.event.type"], ${EVENT}["type"])`,
              `set(log.attributes["k8s.event.count"], 1)`,
              `set(log.attributes["k8s.event.count"], ${EVENT}["deprecatedCount"]) where ${EVENT}["deprecatedCount"] != nil`,
              `set(log.attributes["k8s.event.count"], ${EVENT}["series"]["count"]) where ${EVENT}["series"] != nil`,
              `set(log.attributes["k8s.event.reporter"], ${EVENT}["reportingController"])`,
              `set(log.attributes["k8s.object.kind"], ${EVENT}["regarding"]["kind"])`,
              `set(log.attributes["k8s.object.name"], ${EVENT}["regarding"]["name"])`,
              `set(log.attributes["k8s.object.field_path"], ${EVENT}["regarding"]["fieldPath"])`,
              `set(log.attributes["k8s.pod.name"], ${EVENT}["regarding"]["name"]) where ${EVENT}["regarding"]["kind"] == "Pod"`,
              `set(log.severity_number, SEVERITY_NUMBER_WARN) where ${EVENT}["type"] == "Warning"`,
              `set(log.severity_number, SEVERITY_NUMBER_INFO) where ${EVENT}["type"] != "Warning"`,
              `set(log.severity_text, "warn") where log.severity_number == SEVERITY_NUMBER_WARN`,
              `set(log.severity_text, "info") where log.severity_number == SEVERITY_NUMBER_INFO`,
              `set(log.body, ${EVENT}["note"])`,
            ],
          },
        ],
      },
      "groupbyattrs/k8s_events": {
        keys: ["service.name", LOG_SOURCE_ATTRIBUTE, "k8s.namespace.name", "k8s.pod.name"],
      },
    },
    pipelines: {
      "logs/k8s_events": {
        receivers: [EVENTS_RECEIVER],
        processors: [
          "filter/event_deletions",
          "transform/k8s_events",
          "groupbyattrs/k8s_events",
          "resource/logs_environment",
        ],
        exporters: ["otlp_http/posthog"],
      },
    },
  };
}

const QDRANT_RECEIVER = "prometheus/qdrant";
const CLUSTER_STATE_RECEIVER = "k8s_cluster";

export function qdrantScrape(targets: string[]): CollectorFragment {
  return {
    receivers: {
      [QDRANT_RECEIVER]: {
        config: {
          scrape_configs: [
            {
              job_name: "qdrant",
              scrape_interval: QDRANT_SCRAPE_INTERVAL,
              scrape_timeout: "10s",
              metrics_path: "/metrics",
              static_configs: targets.map((target) => ({
                targets: [target],
                labels: { peer: target.split(".")[0] },
              })),
            },
          ],
        },
      },
    },
    exporters: {
      prometheus: {
        endpoint: `0.0.0.0:${METRICS_EXPORT_PORT}`,
        metric_expiration: "5m",
      },
    },
    pipelines: { "metrics/qdrant": { receivers: [QDRANT_RECEIVER], exporters: ["prometheus"] } },
  };
}

export function clusterState(): CollectorFragment {
  return {
    receivers: {
      [CLUSTER_STATE_RECEIVER]: {
        auth_type: "serviceAccount",
        collection_interval: CLUSTER_STATE_INTERVAL,
        node_conditions_to_report: ["Ready", "MemoryPressure", "DiskPressure", "PIDPressure"],
        allocatable_types_to_report: ["cpu", "memory", "ephemeral-storage", "pods"],
      },
    },
  };
}

export function posthogMetrics(
  host: string,
  projectToken: string,
  environment: string,
  receivers: string[],
): CollectorFragment {
  return {
    processors: {
      "resource/environment": {
        attributes: [{ key: "deployment.environment.name", value: environment, action: "insert" }],
      },
    },
    exporters: {
      "otlp_http/posthog_metrics": {
        metrics_endpoint: `${host.replace(/\/+$/, "")}/i/v1/metrics`,
        headers: { Authorization: `Bearer ${projectToken}` },
        compression: "gzip",
        ...boundedDelivery(1000),
      },
    },
    pipelines: {
      "metrics/posthog": {
        receivers,
        processors: ["resource/environment"],
        exporters: ["otlp_http/posthog_metrics"],
      },
    },
  };
}
