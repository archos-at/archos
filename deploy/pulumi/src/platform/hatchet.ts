/**
 * The Hatchet control plane (ADR-0150): the official `hatchet-ha` chart
 * (https://hatchet-dev.github.io/hatchet-charts), API, gRPC engine, controllers
 * and scheduler as separate Deployments, two replicas each, on
 * `background-work-pg`, with RabbitMQ as the message queue, as Hatchet's
 * high-availability guide describes (`rabbitmq.ts`, three nodes from the
 * RabbitMQ Cluster Operator, never the chart's bundled Bitnami one).
 *
 * Every value below is one the chart's `values.yaml` or templates at
 * `hatchetChartVersion` 0.21.0 read (checked against `hatchet-ha-0.21.0.tgz`),
 * and every engine variable one of Hatchet's "Engine Configuration Options".
 *
 * ITS OWN NAMESPACE, `background-work`, for two reasons the chart decides:
 *   - Its setup and worker-token Jobs add the `SYS_PTRACE` capability
 *     (`charts/hatchet-api/templates/setup-job.yaml`), which the app
 *     namespace's `baseline` Pod Security Standard rejects.
 *   - Its Role lets the API's ServiceAccount get, create, update and delete
 *     every Secret in its namespace (the quickstart writes keys there). In the
 *     app namespace that would be every application credential.
 *
 * THE WORKER TOKEN. The chart's worker-token Job (`hatchet-admin k8s
 * create-worker-token`, on every install and upgrade) writes
 * `HATCHET_CLIENT_TOKEN` into the Secret `hatchet-client-config` of its own
 * namespace. A pod cannot read a Secret of another namespace, so a Job of ours
 * copies that one key into `hatchet-client-token` in the app namespace, with
 * a ServiceAccount that may read exactly the one Secret and patch exactly the
 * other. Every worker tier reads it from there (`app/hatchet-env.ts`).
 *
 * THE DASHBOARD is not exposed: no HTTPRoute, no LoadBalancer. The chart's
 * Caddy (`/api/*` to the API, the rest to the frontend) runs as a ClusterIP
 * Service an operator port-forwards (docs/deployment/hatchet.md).
 */
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

/** Names and ports the chart gives what it creates, as this program sets them. */
export const HATCHET = {
  /** The Helm release name. The chart's Caddyfile names `<release>-api` and `<release>-frontend`. */
  release: "hatchet",
  grpcService: "hatchet-grpc",
  grpcPort: 7070,
  apiService: "hatchet-api",
  apiPort: 8080,
  /** The chart's Caddy, which routes the dashboard; its Service is called `caddy`, pods `app: caddy`. */
  dashboardService: "caddy",
  dashboardPort: 8080,
  /** `SERVER_PROMETHEUS_ADDRESS` of the engine components (Hatchet's default, `:9090`). */
  metricsPort: 9090,
  /** The Secret `hatchet-admin k8s create-worker-token` writes, in the release namespace (`--resource-name` default). */
  clientConfigSecret: "hatchet-client-config",
  tokenKey: "HATCHET_CLIENT_TOKEN",
  /** Our Secret holding `DATABASE_URL`, which the chart renders only with its bundled Postgres. */
  databaseSecret: "hatchet-database",
  sharedConfigSecret: "hatchet-shared-config",
} as const;

/** Where the worker tiers read the token: the app namespace's copy. */
export const HATCHET_TOKEN_SECRET = "hatchet-client-token"; // pragma: allowlist secret (a Secret's name)

/** The backend components and the replica count each runs (`BACKGROUND_WORK.replicas`). */
export const HATCHET_COMPONENTS = {
  api: "hatchet-api",
  grpc: "hatchet-grpc",
  controllers: "hatchet-controllers",
  scheduler: "hatchet-scheduler",
} as const;

/** The in-cluster gRPC address workers dial: `HATCHET_CLIENT_HOST_PORT`. */
export const HATCHET_GRPC_ADDRESS = `${HATCHET.grpcService}.${BACKGROUND_WORK.namespace}.svc.cluster.local:${HATCHET.grpcPort}`;

/**
 * The in-cluster REST API every SDK calls for what is not on the gRPC stream:
 * scheduled runs, crons, cancels, pausing a workflow. The Python SDK reads it as
 * `HATCHET_CLIENT_SERVER_URL`, the TypeScript one as `HATCHET_CLIENT_API_URL`;
 * either without it falls back to the token's `server_url` claim, which is
 * {@link hatchetValues}' `serverUrl`, the port-forwarded dashboard on localhost.
 * The chart's `hatchet-api` Service, `service.externalPort` 8080.
 */
export const HATCHET_API_URL = `http://${HATCHET.apiService}.${BACKGROUND_WORK.namespace}.svc.cluster.local:${HATCHET.apiPort}`;

type Resources = { requests: Record<string, string>; limits: Record<string, string> };

/**
 * Resources per component, with headroom: the chart ships 250m and 1Gi for
 * all. The engine (gRPC: every worker's stream; scheduler: every assignment)
 * gets the CPU, the API and controllers less. Memory requested at its limit.
 */
export const HATCHET_RESOURCES: Record<keyof typeof HATCHET_COMPONENTS | "frontend", Resources> = {
  api: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  grpc: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "1Gi" } },
  controllers: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  scheduler: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "1Gi" } },
  frontend: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
};

/** Two replicas of a component on two nodes when the cluster has them. */
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

/**
 * The prefix the operator's default-user Secret is read under, so its keys
 * (`username`, `password`) become `RABBITMQ_username` and `RABBITMQ_password`.
 */
const RABBITMQ_ENV_PREFIX = "RABBITMQ_";

/**
 * `SERVER_MSGQUEUE_RABBITMQ_URL`, assembled by the kubelet from the operator's
 * Secret: a container's `$(VAR)` in `env` expands from what `envFrom` already
 * set. The chart renders this URL only for its bundled RabbitMQ, and the
 * operator's password exists only once the cluster does, so neither the chart
 * nor this program can write it out. The operator's generated credentials are
 * URL-safe (`docs/deployment/hatchet.md` says how to check).
 */
export const RABBITMQ_URL_ENV = {
  SERVER_MSGQUEUE_KIND: "rabbitmq",
  SERVER_MSGQUEUE_RABBITMQ_URL:
    `amqp://$(${RABBITMQ_ENV_PREFIX}username):$(${RABBITMQ_ENV_PREFIX}password)@${RABBITMQ_HOST}:${RABBITMQ.amqpPort}/`,
};

/**
 * One backend component. `nameOverride` is the pods' `app.kubernetes.io/name`
 * (the chart's selector label), which the network policies, the PDB and the
 * anti-affinity select on. `envFrom` replaces the chart's list, so it names
 * the shared config again, beside our database Secret.
 */
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
    resources: HATCHET_RESOURCES[key],
    podDisruptionBudget: { maxUnavailable: 1 },
    affinity: spreadAffinity(name),
    ...onNodeGroup(cfg.nodeGroups.app),
    ...extra,
  };
}

/**
 * The engine components serve Prometheus metrics on `:9090` (Hatchet's docs:
 * "set on the grpc, controllers and scheduler deployments"); the port is
 * declared and annotated so the node agents scrape it (ADR-0119, `scrape.ts`).
 */
function engine(cfg: DeployConfig, key: "grpc" | "controllers" | "scheduler") {
  return component(cfg, key, {
    env: { ...RABBITMQ_URL_ENV, SERVER_PROMETHEUS_ENABLED: "true", SERVER_PROMETHEUS_ADDRESS: `:${HATCHET.metricsPort}` },
    podAnnotations: scrapeAnnotations(HATCHET.metricsPort),
    deployment: { extraPorts: [{ containerPort: HATCHET.metricsPort, name: "metrics", protocol: "TCP" }] },
  });
}

/** The chart's values. Pure, so a spec can read every one of them. */
export function hatchetValues(cfg: DeployConfig) {
  const { hatchet } = cfg.backgroundWork;
  return {
    global: { sharedConfigSecretName: HATCHET.sharedConfigSecret },
    sharedConfig: {
      enabled: true,
      // One tag for every component, the chart's own mechanism.
      image: { tag: hatchet.imageTag },
      // The dashboard is reached through a port-forward to Caddy only, so its
      // links and cookie name localhost. The engine also stamps this URL into
      // every token as `server_url`; no client uses that claim, because every
      // tier is given the in-cluster API explicitly (`HATCHET_API_URL`).
      serverUrl: `http://localhost:${HATCHET.dashboardPort}`,
      serverAuthCookieDomain: `localhost:${HATCHET.dashboardPort}`,
      serverAuthCookieInsecure: "t",
      serverAuthSetEmailVerified: "t",
      serverAuthBasicAuthEnabled: "t",
      // What a worker token tells the SDK to dial; the SDK's HATCHET_CLIENT_HOST_PORT says it too.
      grpcBroadcastAddress: HATCHET_GRPC_ADDRESS,
      // Plaintext gRPC inside the cluster (`HATCHET_CLIENT_TLS_STRATEGY=none`); NetworkPolicy bounds who connects.
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
      // The init container that waits for the database; the chart pins `latest`.
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
      resources: HATCHET_RESOURCES.frontend,
      ...onNodeGroup(cfg.nodeGroups.app),
    },
    postgres: { enabled: false },
    rabbitmq: { enabled: false },
    caddy: { enabled: true, service: { type: "ClusterIP" } },
  };
}

export interface Hatchet {
  release: k8s.helm.v3.Release;
  /** The Job that copies the worker token into the app namespace. Worker tiers wait for it. */
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
          // `privileged` only because the chart's bootstrap Jobs add SYS_PTRACE;
          // `baseline` is still warned and audited, so anything else that would
          // break it is visible.
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
  /** The namespace and the cluster. */
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
      // The setup Job runs the install migrations and the worker-token Job
      // writes the token; both must finish before anything reads either.
      waitForJobs: true,
      timeout: 1200,
    },
    { provider, dependsOn: [database, ...dependsOn] },
  );
  return { release, tokenSync: installTokenSync(cfg, provider, appNamespace, [release]) };
}

/**
 * Copies `HATCHET_CLIENT_TOKEN` from the chart's `hatchet-client-config` into
 * {@link HATCHET_TOKEN_SECRET} in the app namespace. The target is ours, created
 * empty with its data ignored, so the Job needs only `patch` on that one name.
 * Re-runs when the chart or the image moves (the annotation), which is when the
 * chart's Job minted a fresh token; an older token stays valid.
 */
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
                resources: BOOTSTRAP_JOB_RESOURCES,
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
