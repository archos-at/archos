import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { BACKGROUND_WORK } from "../config/background-work";
import { commonLabels } from "./namespaces";
import { onNodeGroup } from "./scheduling";
import { scrapeAnnotations } from "./scrape";
import { hardenedJobSecurityContext } from "./security";
import { BOOTSTRAP_JOB_RESOURCES, JOB_DEFAULTS } from "../constants";
import { RABBITMQ, RABBITMQ_DEFAULT_USER_SECRET, RABBITMQ_HOST } from "./rabbitmq";
import { scaledCpuRequest } from "../config/cpu-requests";

export const HATCHET = {
  release: "hatchet",
  grpcService: "hatchet-grpc",
  grpcPort: 7070,
  apiService: "hatchet-api",
  apiPort: 8080,
  dashboardService: "caddy",
  dashboardPort: 8080,
  metricsPort: 9090,
  clientConfigSecret: "hatchet-client-config",
  tokenKey: "HATCHET_CLIENT_TOKEN",
  databaseSecret: "hatchet-database",
  sharedConfigSecret: "hatchet-shared-config",
} as const;

export const HATCHET_TOKEN_SECRET = "hatchet-client-token"; // pragma: allowlist secret (a Secret's name)

export const HATCHET_COMPONENTS = {
  api: "hatchet-api",
  grpc: "hatchet-grpc",
  controllers: "controllers",
  scheduler: "scheduler",
} as const;

export const HATCHET_GRPC_ADDRESS = `${HATCHET.grpcService}.${BACKGROUND_WORK.namespace}.svc.cluster.local:${HATCHET.grpcPort}`;

export const HATCHET_API_URL = `http://${HATCHET.apiService}.${BACKGROUND_WORK.namespace}.svc.cluster.local:${HATCHET.apiPort}`;

type Resources = { requests: Record<string, string>; limits: Record<string, string> };

export const HATCHET_RESOURCES: Record<keyof typeof HATCHET_COMPONENTS | "frontend", Resources> = {
  api: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  grpc: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "1Gi" } },
  controllers: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  scheduler: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "1Gi" } },
  frontend: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
};

function spreadAffinity(name: string) {
  return {
    podAntiAffinity: {
      preferredDuringSchedulingIgnoredDuringExecution: [
        {
          weight: 100,
          podAffinityTerm: {
            topologyKey: "kubernetes.io/hostname",
            labelSelector: { matchLabels: { "app.kubernetes.io/name": name } },
          },
        },
      ],
    },
  };
}

const RABBITMQ_ENV_PREFIX = "RABBITMQ_";

export const RABBITMQ_URL_ENV = {
  SERVER_MSGQUEUE_KIND: "rabbitmq",
  SERVER_MSGQUEUE_RABBITMQ_URL:
    `amqp://$(${RABBITMQ_ENV_PREFIX}username):$(${RABBITMQ_ENV_PREFIX}password)@${RABBITMQ_HOST}:${RABBITMQ.amqpPort}/`,
};

function component(cfg: DeployConfig, key: keyof typeof HATCHET_COMPONENTS, extra: Record<string, unknown> = {}) {
  const name = HATCHET_COMPONENTS[key];
  return {
    nameOverride: name,
    fullnameOverride: name,
    replicaCount: BACKGROUND_WORK.replicas[key],
    serviceAccount: { create: true, name },
    envFrom: [
      { secretRef: { name: HATCHET.sharedConfigSecret } },
      { secretRef: { name: HATCHET.databaseSecret } },
      { prefix: RABBITMQ_ENV_PREFIX, secretRef: { name: RABBITMQ_DEFAULT_USER_SECRET } },
    ],
    env: RABBITMQ_URL_ENV,
    ingress: { enabled: false },
    resources: scaledCpuRequest(HATCHET_RESOURCES[key]),
    podDisruptionBudget: { maxUnavailable: 1 },
    affinity: spreadAffinity(name),
    ...onNodeGroup(cfg.nodeGroups.app),
    ...extra,
  };
}

function engine(cfg: DeployConfig, key: "grpc" | "controllers" | "scheduler") {
  return component(cfg, key, {
    env: { ...RABBITMQ_URL_ENV, SERVER_PROMETHEUS_ENABLED: "true", SERVER_PROMETHEUS_ADDRESS: `:${HATCHET.metricsPort}` },
    podAnnotations: scrapeAnnotations(HATCHET.metricsPort),
    deployment: { extraPorts: [{ containerPort: HATCHET.metricsPort, name: "metrics", protocol: "TCP" }] },
  });
}

export function hatchetValues(cfg: DeployConfig) {
  const { hatchet } = cfg.backgroundWork;
  return {
    global: { sharedConfigSecretName: HATCHET.sharedConfigSecret },
    sharedConfig: {
      enabled: true,
      image: { tag: hatchet.imageTag },
      serverUrl: `http://localhost:${HATCHET.dashboardPort}`,
      serverAuthCookieDomain: `localhost:${HATCHET.dashboardPort}`,
      serverAuthCookieInsecure: "t",
      serverAuthSetEmailVerified: "t",
      serverAuthBasicAuthEnabled: "t",
      grpcBroadcastAddress: HATCHET_GRPC_ADDRESS,
      grpcInsecure: "t",
      defaultAdminEmail: hatchet.adminEmail,
      defaultAdminPassword: hatchet.adminPassword,
      env: {
        SERVER_LIMITS_DEFAULT_TENANT_RETENTION_PERIOD: BACKGROUND_WORK.retention,
        DATABASE_MAX_CONNS: String(BACKGROUND_WORK.engineMaxConns),
        SERVER_ALLOW_SIGNUP: "false",
      },
    },
    api: component(cfg, "api", {
      postgresImage: { tag: "17-alpine" },
    }),
    grpc: engine(cfg, "grpc"),
    controllers: engine(cfg, "controllers"),
    scheduler: engine(cfg, "scheduler"),
    frontend: {
      nameOverride: "hatchet-frontend",
      fullnameOverride: "hatchet-frontend",
      replicaCount: 1,
      ingress: { enabled: false },
      resources: scaledCpuRequest(HATCHET_RESOURCES.frontend),
      ...onNodeGroup(cfg.nodeGroups.app),
    },
    postgres: { enabled: false },
    rabbitmq: { enabled: false },
    caddy: { enabled: true, service: { type: "ClusterIP" } },
  };
}

export interface Hatchet {
  release: k8s.helm.v3.Release;
  tokenSync: k8s.batch.v1.Job;
}

export function installHatchetNamespace(provider: k8s.Provider): k8s.core.v1.Namespace {
  return new k8s.core.v1.Namespace(
    "background-work-ns",
    {
      metadata: {
        name: BACKGROUND_WORK.namespace,
        labels: {
          ...(commonLabels("background-work") as Record<string, string>),
          "pod-security.kubernetes.io/enforce": "privileged",
          "pod-security.kubernetes.io/warn": "baseline",
          "pod-security.kubernetes.io/audit": "baseline",
        },
      },
    },
    { provider },
  );
}

export function installHatchet(
  cfg: DeployConfig,
  provider: k8s.Provider,
  appNamespace: pulumi.Input<string>,
  databaseUrl: pulumi.Output<string>,
  dependsOn: pulumi.Resource[],
): Hatchet {
  const namespace = BACKGROUND_WORK.namespace;
  const database = new k8s.core.v1.Secret(
    HATCHET.databaseSecret,
    { metadata: { name: HATCHET.databaseSecret, namespace }, stringData: { DATABASE_URL: databaseUrl } },
    { provider, dependsOn },
  );
  const release = new k8s.helm.v3.Release(
    "hatchet",
    {
      name: HATCHET.release,
      chart: "hatchet-ha",
      version: cfg.backgroundWork.hatchet.chartVersion,
      namespace,
      repositoryOpts: { repo: "https://hatchet-dev.github.io/hatchet-charts" },
      values: hatchetValues(cfg),
      waitForJobs: true,
      timeout: 1200,
    },
    { provider, dependsOn: [database, ...dependsOn] },
  );
  return { release, tokenSync: installTokenSync(cfg, provider, appNamespace, [release]) };
}

function installTokenSync(
  cfg: DeployConfig,
  provider: k8s.Provider,
  appNamespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const name = "hatchet-token-sync";
  const labels = commonLabels(name);
  const namespace = BACKGROUND_WORK.namespace;
  const target = new k8s.core.v1.Secret(
    HATCHET_TOKEN_SECRET,
    { metadata: { name: HATCHET_TOKEN_SECRET, namespace: appNamespace, labels }, stringData: {} },
    { provider, ignoreChanges: ["data", "stringData"] },
  );
  const account = new k8s.core.v1.ServiceAccount(name, { metadata: { name, namespace, labels } }, { provider });
  const subject = [{ kind: "ServiceAccount", name, namespace }];
  const source = new k8s.rbac.v1.Role(
    `${name}-read`,
    {
      metadata: { name: `${name}-read`, namespace, labels },
      rules: [{ apiGroups: [""], resources: ["secrets"], resourceNames: [HATCHET.clientConfigSecret], verbs: ["get"] }],
    },
    { provider },
  );
  const sink = new k8s.rbac.v1.Role(
    `${name}-write`,
    {
      metadata: { name: `${name}-write`, namespace: appNamespace, labels },
      rules: [{ apiGroups: [""], resources: ["secrets"], resourceNames: [HATCHET_TOKEN_SECRET], verbs: ["get", "patch"] }],
    },
    { provider },
  );
  const bind = (suffix: string, role: k8s.rbac.v1.Role, ns: pulumi.Input<string>) =>
    new k8s.rbac.v1.RoleBinding(
      `${name}-${suffix}`,
      {
        metadata: { name: `${name}-${suffix}`, namespace: ns, labels },
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: role.metadata.name },
        subjects: subject,
      },
      { provider },
    );
  const bindings = [bind("read", source, namespace), bind("write", sink, appNamespace)];
  const api = "https://kubernetes.default.svc";
  const script = pulumi.interpolate`set -eu
T=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
until TOKEN=$(curl -sf --cacert $CA -H "Authorization: Bearer $T" ${api}/api/v1/namespaces/${namespace}/secrets/${HATCHET.clientConfigSecret} | tr -d '\\n ' | sed -n 's/.*"${HATCHET.tokenKey}":"\\([^"]*\\)".*/\\1/p') && [ -n "$TOKEN" ]; do echo 'waiting for the worker token'; sleep 5; done
curl -sf --cacert $CA -H "Authorization: Bearer $T" -H 'Content-Type: application/merge-patch+json' -X PATCH -d "{\\"data\\":{\\"${HATCHET.tokenKey}\\":\\"$TOKEN\\"}}" ${api}/api/v1/namespaces/${appNamespace}/secrets/${HATCHET_TOKEN_SECRET} >/dev/null
echo 'worker token copied'`;
  const { chartVersion, imageTag } = cfg.backgroundWork.hatchet;
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: { namespace, labels },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels, annotations: { "hatchet.run/release": `${chartVersion}/${imageTag}` } },
          spec: {
            serviceAccountName: name,
            restartPolicy: "OnFailure",
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "copy",
                image: "curlimages/curl:8.11.1",
                securityContext: hardenedJobSecurityContext(),
                resources: scaledCpuRequest(BOOTSTRAP_JOB_RESOURCES),
                command: ["/bin/sh", "-c"],
                args: [script],
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [target, account, source, sink, ...bindings, ...dependsOn], replaceOnChanges: ["spec"] },
  );
}
