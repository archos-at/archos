import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { AUTOSCALER_SAFE_TO_EVICT, BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS, PORT, QDRANT, UID } from "../constants";
import { commonLabels } from "../platform/namespaces";
import {
  ROLLOUT,
  gracefulShutdown,
  orderedRollout,
  secretChecksum,
  secretChecksumAnnotations,
} from "../platform/rollout";
import { installPdb, onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { qdrantAlertRules } from "./qdrant-alerts";
import { scaledCpuRequest } from "../config/cpu-requests";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export interface Qdrant {
  statefulSet: k8s.apps.v1.StatefulSet;
  service: k8s.core.v1.Service;
  snapshotCronJob: k8s.batch.v1.CronJob;
  alertRules: k8s.core.v1.ConfigMap;
  url: pulumi.Output<string>;
  metricsTargets: pulumi.Output<string[]>;
}

const KEY = {
  apiKey: "api-key", // pragma: allowlist secret (Secret key name, not a credential)
  readOnlyApiKey: "read-only-api-key", // pragma: allowlist secret (Secret key name, not a credential)
  altApiKey: "alt-api-key", // pragma: allowlist secret (Secret key name, not a credential)
  s3SecretKey: "s3-secret-key", // pragma: allowlist secret (Secret key name, not a credential)
} as const;

const CURL_UID = 100;

export function installQdrant(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  s3Endpoint: pulumi.Input<string>,
  snapshotDeps: pulumi.Resource[] = [],
): Qdrant {
  const labels = commonLabels(QDRANT.name);
  const { secret, checksum } = qdrantSecret(cfg, provider, namespace);
  const ns = pulumi.output(namespace);

  const statefulSet = new k8s.apps.v1.StatefulSet(
    QDRANT.name,
    {
      metadata: { name: QDRANT.name, namespace, labels },
      spec: {
        serviceName: QDRANT.headless,
        replicas: cfg.qdrant.replicas,
        podManagementPolicy: "Parallel",
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        ...orderedRollout(ROLLOUT.vectorStore),
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: {
              [AUTOSCALER_SAFE_TO_EVICT]: "false",
              ...secretChecksumAnnotations(checksum),
            },
          },
          spec: qdrantPodSpec(cfg, ns, s3Endpoint, labels),
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: cfg.storage.className,
              resources: { requests: { storage: cfg.qdrant.storageSize } },
            },
          },
        ],
      },
    },
    {
      provider,
      dependsOn: [secret],
      ignoreChanges: ["spec.volumeClaimTemplates"],
      deleteBeforeReplace: true,
      protect: cfg.protectDataResources,
      customTimeouts: { create: "30m", update: "30m" },
    },
  );

  new k8s.core.v1.Service(
    QDRANT.headless,
    {
      metadata: { name: QDRANT.headless, namespace, labels },
      spec: {
        clusterIP: "None",
        publishNotReadyAddresses: true,
        selector: labels,
        ports: [
          { port: PORT.qdrantHttp, targetPort: PORT.qdrantHttp, name: "http" },
          { port: PORT.qdrantGrpc, targetPort: PORT.qdrantGrpc, name: "grpc" },
          { port: PORT.qdrantP2p, targetPort: PORT.qdrantP2p, name: "p2p" },
          { port: PORT.qdrantMetrics, targetPort: PORT.qdrantMetrics, name: "metrics" },
        ],
      },
    },
    { provider },
  );

  const service = new k8s.core.v1.Service(
    QDRANT.name,
    {
      metadata: { name: QDRANT.name, namespace, labels },
      spec: {
        selector: labels,
        ports: [
          { port: PORT.qdrantHttp, targetPort: PORT.qdrantHttp, name: "http" },
          { port: PORT.qdrantGrpc, targetPort: PORT.qdrantGrpc, name: "grpc" },
        ],
      },
    },
    { provider, dependsOn: statefulSet },
  );

  if (cfg.qdrant.replicas > 1) {
    installPdb(QDRANT.name, namespace, provider, labels, [statefulSet]);
  }

  const snapshotCronJob = installSnapshotCronJob(cfg, provider, namespace, s3Endpoint, [
    secret,
    service,
    ...snapshotDeps,
  ]);

  const alertRules = new k8s.core.v1.ConfigMap(
    QDRANT.alertRules,
    {
      metadata: { name: QDRANT.alertRules, namespace, labels },
      data: { "qdrant.rules.yaml": qdrantAlertRules(cfg) },
    },
    { provider },
  );

  return {
    statefulSet,
    service,
    snapshotCronJob,
    alertRules,
    url: pulumi.interpolate`http://${QDRANT.name}.${ns}.svc.cluster.local:${PORT.qdrantHttp}`,
    metricsTargets: ns.apply((n) => metricsTargets(n, cfg.qdrant.replicas)),
  };
}

function qdrantSecret(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): { secret: k8s.core.v1.Secret; checksum: pulumi.Output<string> } {
  const values: Record<string, pulumi.Input<string>> = {
    [KEY.apiKey]: cfg.qdrant.apiKey,
    [KEY.readOnlyApiKey]: cfg.qdrant.readOnlyApiKey,
    [KEY.s3SecretKey]: cfg.qdrant.snapshots.s3SecretKey,
    ...(cfg.qdrant.altApiKey ? { [KEY.altApiKey]: cfg.qdrant.altApiKey } : {}),
  };
  const secret = new k8s.core.v1.Secret(
    QDRANT.secret,
    { metadata: { name: QDRANT.secret, namespace }, stringData: values },
    { provider },
  );
  return { secret, checksum: secretChecksum(values) };
}

function qref(name: string, key: string): EnvVar {
  return { name, valueFrom: { secretKeyRef: { name: QDRANT.secret, key } } };
}

function p2pUri(namespace: string, ordinal: string): string {
  return `http://${QDRANT.name}-${ordinal}.${QDRANT.headless}.${namespace}:${PORT.qdrantP2p}`;
}

export function bootstrapScript(namespace: string, replicas: number): string {
  const head = ["set -eu", 'ulimit -n "$(ulimit -Hn)"'];
  if (replicas === 1) return [...head, "exec ./entrypoint.sh"].join("\n");
  return [
    ...head,
    'ordinal="${HOSTNAME##*-}"',
    'if [ "$ordinal" = "0" ]; then',
    `  exec ./entrypoint.sh --uri '${p2pUri(namespace, "0")}'`,
    "fi",
    `exec ./entrypoint.sh --bootstrap '${p2pUri(namespace, "0")}' --uri "${p2pUri(namespace, "${ordinal}")}"`,
  ].join("\n");
}

export function qdrantEnv(cfg: DeployConfig, s3Endpoint: pulumi.Input<string>): EnvVar[] {
  const clustered = cfg.qdrant.replicas > 1;
  return [
    { name: "QDRANT_INIT_FILE_PATH", value: "/qdrant/init/.qdrant-initialized" },
    { name: "QDRANT__LOG_LEVEL", value: "INFO" },
    { name: "QDRANT__TELEMETRY_DISABLED", value: "true" },
    { name: "QDRANT__SERVICE__HTTP_PORT", value: String(PORT.qdrantHttp) },
    { name: "QDRANT__SERVICE__METRICS_PORT", value: String(PORT.qdrantMetrics) },
    { name: "QDRANT__SERVICE__GRPC_PORT", value: String(PORT.qdrantGrpc) },
    { name: "QDRANT__STORAGE__STORAGE_PATH", value: "/qdrant/storage" },
    { name: "QDRANT__STORAGE__SNAPSHOTS_PATH", value: "/qdrant/snapshots" },
    qref("QDRANT__SERVICE__API_KEY", KEY.apiKey),
    qref("QDRANT__SERVICE__READ_ONLY_API_KEY", KEY.readOnlyApiKey),
    ...(cfg.qdrant.altApiKey ? [qref("QDRANT__SERVICE__ALT_API_KEY", KEY.altApiKey)] : []),
    { name: "QDRANT__CLUSTER__ENABLED", value: String(clustered) },
    { name: "QDRANT__STORAGE__QUOTAS__ENABLED", value: "true" },
    {
      name: "QDRANT__STORAGE__QUOTAS__MAX_RESIDENT_MEMORY_PERCENT",
      value: String(cfg.qdrant.quotas.memoryPercent),
    },
    { name: "QDRANT__STORAGE__QUOTAS__MAX_DISK_USAGE_PERCENT", value: String(cfg.qdrant.quotas.diskPercent) },
    ...(cfg.qdrant.lowMemoryMode
      ? [{ name: "QDRANT__STORAGE__LOW_MEMORY_MODE", value: cfg.qdrant.lowMemoryMode }]
      : []),
    ...(clustered ? [{ name: "QDRANT__SERVICE__ENFORCE_INTERNAL_AUTH", value: "true" }] : []),
    { name: "QDRANT__STORAGE__SNAPSHOTS_CONFIG__SNAPSHOTS_STORAGE", value: "s3" },
    { name: "QDRANT__STORAGE__SNAPSHOTS_CONFIG__S3_CONFIG__BUCKET", value: QDRANT.snapshotBucket },
    { name: "QDRANT__STORAGE__SNAPSHOTS_CONFIG__S3_CONFIG__REGION", value: QDRANT.s3Region },
    { name: "QDRANT__STORAGE__SNAPSHOTS_CONFIG__S3_CONFIG__ENDPOINT_URL", value: s3Endpoint },
    { name: "QDRANT__STORAGE__SNAPSHOTS_CONFIG__S3_CONFIG__ACCESS_KEY", value: cfg.qdrant.snapshots.s3AccessKey },
    qref("QDRANT__STORAGE__SNAPSHOTS_CONFIG__S3_CONFIG__SECRET_KEY", KEY.s3SecretKey),
  ];
}

function antiAffinity(
  cfg: DeployConfig,
  labels: pulumi.Input<{ [k: string]: string }>,
): k8s.types.input.core.v1.Affinity {
  const term = { labelSelector: { matchLabels: labels }, topologyKey: "kubernetes.io/hostname" };
  if (cfg.qdrant.replicas > 1 && cfg.nodeGroups.data) {
    return { podAntiAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [term] } };
  }
  return { podAntiAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100, podAffinityTerm: term }] } };
}

function qdrantPodSpec(
  cfg: DeployConfig,
  namespace: pulumi.Output<string>,
  s3Endpoint: pulumi.Input<string>,
  labels: pulumi.Input<{ [k: string]: string }>,
): k8s.types.input.core.v1.PodSpec {
  const shutdown = gracefulShutdown(ROLLOUT.vectorStore, "coreutils");
  const envelope = { cpu: cfg.qdrant.cpu, memory: cfg.qdrant.memory };
  const http = { port: PORT.qdrantHttp };
  return {
    ...onNodeGroup(cfg.nodeGroups.data),
    affinity: antiAffinity(cfg, labels),
    terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
    enableServiceLinks: false,
    securityContext: {
      runAsNonRoot: true,
      runAsUser: UID.qdrant,
      runAsGroup: UID.qdrant,
      fsGroup: UID.qdrant,
      fsGroupChangePolicy: "OnRootMismatch",
    },
    containers: [
      {
        name: QDRANT.name,
        image: cfg.qdrant.image,
        imagePullPolicy: pullPolicyFor(cfg.qdrant.image),
        command: ["/bin/bash", "-c"],
        args: [namespace.apply((ns) => bootstrapScript(ns, cfg.qdrant.replicas))],
        env: qdrantEnv(cfg, s3Endpoint),
        ports: [
          { containerPort: PORT.qdrantHttp, name: "http" },
          { containerPort: PORT.qdrantGrpc, name: "grpc" },
          { containerPort: PORT.qdrantP2p, name: "p2p" },
          { containerPort: PORT.qdrantMetrics, name: "metrics" },
        ],
        startupProbe: { httpGet: { path: "/livez", ...http }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 90 },
        readinessProbe: { httpGet: { path: "/readyz", ...http }, periodSeconds: 5, timeoutSeconds: 3, failureThreshold: 6 },
        livenessProbe: { httpGet: { path: "/livez", ...http }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 6 },
        lifecycle: shutdown.lifecycle,
        resources: scaledCpuRequest({ requests: envelope, limits: envelope }),
        securityContext: { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true },
        volumeMounts: [
          { name: "data", mountPath: "/qdrant/storage" },
          { name: "snapshots", mountPath: "/qdrant/snapshots" },
          { name: "init", mountPath: "/qdrant/init" },
        ],
      },
    ],
    volumes: [
      { name: "snapshots", emptyDir: {} },
      { name: "init", emptyDir: {} },
    ],
  };
}

function peerHost(namespace: string, i: number): string {
  return `${QDRANT.name}-${i}.${QDRANT.headless}.${namespace}.svc.cluster.local`;
}

export function peerUrls(namespace: string, replicas: number): string[] {
  return Array.from({ length: replicas }, (_, i) => `http://${peerHost(namespace, i)}:${PORT.qdrantHttp}`);
}

export function metricsTargets(namespace: string, replicas: number): string[] {
  return Array.from({ length: replicas }, (_, i) => `${peerHost(namespace, i)}:${PORT.qdrantMetrics}`);
}

export function snapshotScript(): string {
  return String.raw`set -eu -o pipefail
q() { curl -fsS --connect-timeout 10 -H "api-key: $QDRANT_API_KEY" "$@"; }
s3() { curl -fsS --connect-timeout 10 --aws-sigv4 "aws:amz:$S3_REGION:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" "$@"; }
# No collection yet is no name, not a failure: under pipefail a grep with no
# match would fail the listing and report every fresh cluster as a broken backup.
names() { { grep -o '"name":"[^"]*"' || true; } | cut -d'"' -f4; }
cutoff=$(date -u -d "@$(( $(date +%s) - RETENTION_DAYS * 86400 ))" +%Y%m%d%H%M%S)
# A snapshot younger than this counts as today's: a retried run does not take another.
FRESH_HOURS=20
fresh_cutoff=$(date -u -d "@$(( $(date +%s) - FRESH_HOURS * 3600 ))" +%Y%m%d%H%M%S)
failed=0
fail() { echo "FAILED: $*"; failed=1; }
# The YYYYMMDDHHMMSS of a name stamped -YYYY-MM-DD-HH-MM-SS before suffix $2, or nothing.
stamp() {
  echo "$1" | sed -n "s/.*-\([0-9]\{4\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)$2\$/\1\2\3\4\5\6/p"
}
# True when such a name is older than the retention cutoff.
expired() {
  ts=$(stamp "$1" "$2")
  [ -n "$ts" ] && awk -v t="$ts" -v c="$cutoff" 'BEGIN { exit !(t < c) }'
}
# True when such a name is younger than FRESH_HOURS.
recent() {
  ts=$(stamp "$1" "$2")
  [ -n "$ts" ] && awk -v t="$ts" -v c="$fresh_cutoff" 'BEGIN { exit !(t >= c) }'
}
# True when collection $2 on peer $1 already holds a snapshot from the last FRESH_HOURS.
has_recent() {
  for s in $(q "$1/collections/$2/snapshots" | names); do
    recent "$s" '\.snapshot' && return 0
  done
  return 1
}
expire() {
  peer=$1 c=$2
  snapshots=$(q "$peer/collections/$c/snapshots" | names) || { fail "cannot list snapshots of $c on $peer"; return; }
  for s in $snapshots; do
    expired "$s" '\.snapshot' || continue
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "api-key: $QDRANT_API_KEY" "$peer/collections/$c/snapshots/$s?wait=true") || code=000
    case "$code" in
      200|404) echo "expired $s" ;;
      *) fail "delete $s on $peer (HTTP $code)" ;;
    esac
  done
}
expire_aliases() {
  keys=$(s3 "$S3_ENDPOINT/$S3_BUCKET?list-type=2&prefix=$ALIASES_PREFIX" | { grep -o '<Key>[^<]*</Key>' || true; } | sed 's/<[^>]*>//g') || { fail "cannot list $ALIASES_PREFIX"; return; }
  for k in $keys; do
    expired "$k" '\.json' || continue
    if s3 -X DELETE "$S3_ENDPOINT/$S3_BUCKET/$k" >/dev/null; then echo "expired $k"; else fail "delete $k"; fi
  done
}
record_aliases() {
  for peer in $PEERS; do
    aliases=$(q --retry 3 --retry-all-errors "$peer/aliases") || continue
    key="$ALIASES_PREFIX""aliases-$(date -u +%Y-%m-%d-%H-%M-%S).json"
    if printf '%s' "$aliases" | s3 -X PUT -H 'content-type: application/json' --data-binary @- "$S3_ENDPOINT/$S3_BUCKET/$key" >/dev/null; then
      echo "recorded $key from $peer: $aliases"
      expire_aliases
    else
      fail "upload $key"
    fi
    return
  done
  fail "cannot read aliases from any peer"
}
record_aliases
for peer in $PEERS; do
  collections=$(q --retry 3 --retry-all-errors "$peer/collections" | names) || { fail "cannot list collections on $peer"; continue; }
  [ -n "$collections" ] || echo "no collections on $peer"
  for c in $collections; do
    # A failed run is retried by the Job (backoffLimit), and every retry used to
    # snapshot every collection on every peer again: prod's qdrant-snapshots grew
    # to 74 GB by 2026-11-14 at three rounds a day that expiry never caught up with.
    if has_recent "$peer" "$c"; then
      echo "snapshot $c on $peer: one from the last $FRESH_HOURS h exists, not taken again"
      expire "$peer" "$c"
    elif q --max-time 3600 -X POST "$peer/collections/$c/snapshots?wait=true" >/dev/null; then
      echo "snapshot $c on $peer"
      expire "$peer" "$c"
    else
      fail "snapshot $c on $peer"
    fi
  done
done
exit "$failed"`;
}

function installSnapshotCronJob(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  s3Endpoint: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.CronJob {
  const labels = commonLabels(QDRANT.snapshotJob);
  return new k8s.batch.v1.CronJob(
    QDRANT.snapshotJob,
    {
      metadata: { name: QDRANT.snapshotJob, namespace, labels },
      spec: {
        schedule: cfg.qdrant.snapshots.schedule,
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
          spec: {
            backoffLimit: 2,
            activeDeadlineSeconds: 6 * 3600,
            ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
            template: {
              metadata: { labels },
              spec: {
                enableServiceLinks: false,
                restartPolicy: "OnFailure",
                securityContext: { runAsNonRoot: true, runAsUser: CURL_UID, runAsGroup: CURL_UID },
                ...onNodeGroup(cfg.nodeGroups.app),
                containers: [
                  {
                    name: QDRANT.snapshotJob,
                    image: QDRANT.curlImage,
                    imagePullPolicy: pullPolicyFor(QDRANT.curlImage),
                    securityContext: { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true },
                    resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                    command: ["/bin/sh", "-c", snapshotScript()],
                    env: [
                      {
                        name: "PEERS",
                        value: pulumi.output(namespace).apply((ns) => peerUrls(ns, cfg.qdrant.replicas).join(" ")),
                      },
                      { name: "RETENTION_DAYS", value: String(cfg.qdrant.snapshots.retentionDays) },
                      qref("QDRANT_API_KEY", KEY.apiKey),
                      { name: "S3_ENDPOINT", value: s3Endpoint },
                      { name: "S3_BUCKET", value: QDRANT.snapshotBucket },
                      { name: "S3_REGION", value: QDRANT.s3Region },
                      { name: "S3_ACCESS_KEY", value: cfg.qdrant.snapshots.s3AccessKey },
                      qref("S3_SECRET_KEY", KEY.s3SecretKey),
                      { name: "ALIASES_PREFIX", value: QDRANT.aliasesPrefix },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
    { provider, dependsOn },
  );
}
