import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import {
  ROLLOUT,
  gracefulShutdown,
  orderedRollout,
  secretChecksum,
  secretChecksumAnnotations,
} from "../platform/rollout";
import { DATA_RESOURCES, LANGFUSE, PORT } from "../constants";
import { scrapeAnnotations } from "../platform/scrape";
import { scaledCpuRequest } from "../config/cpu-requests";

export const CLICKHOUSE_PASSWORD_SECRET_KEY = "clickhouse-password"; // pragma: allowlist secret (Secret key name, not a credential)

const SECRET_NAME = "clickhouse-auth"; // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)

// system.trace_log alone grew to 17 GiB on dev and filled its volume in August 2026.
const SYSTEM_LOG_TTL_DAYS = 14;

const PROMETHEUS_XML = `<clickhouse>
  <prometheus>
    <endpoint>/metrics</endpoint>
    <port>${PORT.clickhouseMetrics}</port>
    <metrics>true</metrics>
    <events>true</events>
    <asynchronous_metrics>true</asynchronous_metrics>
  </prometheus>
</clickhouse>`;

const SYSTEM_LOG_TTL_XML = `<clickhouse>
  <asynchronous_insert_log><table>asynchronous_insert_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></asynchronous_insert_log>
  <asynchronous_metric_log><table>asynchronous_metric_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></asynchronous_metric_log>
  <background_schedule_pool_log><table>background_schedule_pool_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></background_schedule_pool_log>
  <error_log><table>error_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></error_log>
  <metric_log><table>metric_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></metric_log>
  <part_log><table>part_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></part_log>
  <processors_profile_log><table>processors_profile_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></processors_profile_log>
  <query_log><table>query_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></query_log>
  <query_metric_log><table>query_metric_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></query_metric_log>
  <text_log><table>text_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></text_log>
  <trace_log><table>trace_log</table><ttl>event_date + INTERVAL ${SYSTEM_LOG_TTL_DAYS} DAY DELETE</ttl></trace_log>
</clickhouse>`;

export interface ClickHouse {
  statefulSet: k8s.apps.v1.StatefulSet;
  service: k8s.core.v1.Service;
  secret: k8s.core.v1.Secret;
  config: k8s.core.v1.ConfigMap;
  httpUrl: pulumi.Output<string>;
  migrationUrl: pulumi.Output<string>;
}

export function installClickHouse(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): ClickHouse {
  const name = LANGFUSE.clickhouse;
  const labels = commonLabels(name);
  const image = cfg.langfuse.clickhouseImage;

  const secretValues = { [CLICKHOUSE_PASSWORD_SECRET_KEY]: cfg.langfuse.clickhousePassword };
  const secret = new k8s.core.v1.Secret(
    SECRET_NAME,
    {
      metadata: { name: SECRET_NAME, namespace, labels },
      stringData: secretValues,
    },
    { provider, dependsOn },
  );

  const configD = new k8s.core.v1.ConfigMap(
    `${name}-config`,
    {
      metadata: { name: `${name}-config`, namespace, labels },
      data: { "system-log-ttl.xml": SYSTEM_LOG_TTL_XML, "prometheus.xml": PROMETHEUS_XML },
    },
    { provider, dependsOn },
  );

  const statefulSet = new k8s.apps.v1.StatefulSet(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        serviceName: `${name}-headless`,
        replicas: 1,
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.dataPlane),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: {
              ...secretChecksumAnnotations(
                secretChecksum({
                  ...secretValues,
                  "system-log-ttl.xml": SYSTEM_LOG_TTL_XML,
                  "prometheus.xml": PROMETHEUS_XML,
                }),
              ),
              ...scrapeAnnotations(PORT.clickhouseMetrics),
            },
          },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            securityContext: { runAsNonRoot: true, runAsUser: 101, runAsGroup: 101, fsGroup: 101 },
            terminationGracePeriodSeconds:
              gracefulShutdown(ROLLOUT.dataPlane).terminationGracePeriodSeconds,
            volumes: [{ name: "config-d", configMap: { name: configD.metadata.name } }],
            ...onNodeGroup(cfg.nodeGroups.data),
            containers: [
              {
                name: "clickhouse",
                image,
                imagePullPolicy: pullPolicyFor(image),
                ports: [
                  { containerPort: PORT.clickhouseHttp, name: "http" },
                  { containerPort: PORT.clickhouseNative, name: "native" },
                  { containerPort: PORT.clickhouseMetrics, name: "metrics" },
                ],
                env: [
                  { name: "CLICKHOUSE_DB", value: LANGFUSE.clickhouseDatabase },
                  { name: "CLICKHOUSE_USER", value: LANGFUSE.clickhouseUser },
                  {
                    name: "CLICKHOUSE_PASSWORD",
                    valueFrom: {
                      secretKeyRef: { name: SECRET_NAME, key: CLICKHOUSE_PASSWORD_SECRET_KEY },
                    },
                  },
                  { name: "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", value: "0" },
                  { name: "TZ", value: "UTC" },
                ],
                volumeMounts: [
                  { name: "data", mountPath: "/var/lib/clickhouse" },
                  {
                    name: "config-d",
                    mountPath: "/etc/clickhouse-server/config.d/system-log-ttl.xml",
                    subPath: "system-log-ttl.xml",
                    readOnly: true,
                  },
                  {
                    name: "config-d",
                    mountPath: "/etc/clickhouse-server/config.d/prometheus.xml",
                    subPath: "prometheus.xml",
                    readOnly: true,
                  },
                ],
                resources: scaledCpuRequest(DATA_RESOURCES.clickhouse),
                startupProbe: {
                  httpGet: { path: "/ping", port: PORT.clickhouseHttp },
                  periodSeconds: 10,
                  failureThreshold: 30,
                },
                readinessProbe: {
                  httpGet: { path: "/ping", port: PORT.clickhouseHttp },
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                },
                livenessProbe: {
                  httpGet: { path: "/ping", port: PORT.clickhouseHttp },
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                  failureThreshold: 6,
                },
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: cfg.storage.className,
              resources: { requests: { storage: cfg.langfuse.clickhouseStorageSize } },
            },
          },
        ],
      },
    },
    {
      provider,
      dependsOn: [...dependsOn, secret, configD],
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
    },
  );

  new k8s.core.v1.Service(
    `${name}-headless`,
    {
      metadata: { name: `${name}-headless`, namespace, labels },
      spec: {
        clusterIP: "None",
        selector: labels,
        ports: [
          { port: PORT.clickhouseHttp, name: "http" },
          { port: PORT.clickhouseNative, name: "native" },
        ],
      },
    },
    { provider },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        selector: labels,
        ports: [
          { port: PORT.clickhouseHttp, targetPort: PORT.clickhouseHttp, name: "http" },
          { port: PORT.clickhouseNative, targetPort: PORT.clickhouseNative, name: "native" },
        ],
      },
    },
    { provider, dependsOn: statefulSet },
  );

  return {
    statefulSet,
    service,
    secret,
    config: configD,
    httpUrl: pulumi.output(`http://${name}:${PORT.clickhouseHttp}`),
    migrationUrl: pulumi.output(`clickhouse://${name}:${PORT.clickhouseNative}`),
  };
}
