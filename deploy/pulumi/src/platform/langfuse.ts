import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "./scheduling";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "./namespaces";
import {
  ROLLOUT,
  assertStartupFitsRollout,
  gracefulShutdown,
  recreateRollout,
  secretChecksum,
  secretChecksumAnnotations,
  startupBudgetSeconds,
} from "./rollout";
import { GATEWAY_NAME } from "./gateway";
import { OBSERVABILITY_VIEW_PERMISSION, OIDC_CLIENT_SECRET_KEY, platformOidcSecurityPolicySpec } from "./platform-oidc";
import { EDGE_TIMEOUT, LANGFUSE, PORT } from "../constants";
import { logicalName, objectName } from "../names";

const SECRETS_NAME = "langfuse-secrets"; // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)

export const LANGFUSE_SECRETS_NAME = SECRETS_NAME;

const LANGFUSE_IMAGE_UID = 1001;

export function langfuseV4MigrationEnv(historicBackfill: boolean): k8s.types.input.core.v1.EnvVar[] {
  return [
    { name: "LANGFUSE_MIGRATION_V4_WRITE_MODE", value: "events_only" },
    { name: "LANGFUSE_MIGRATION_V4_NATIVE_OTEL_BEHAVIOUR", value: "direct" },
    { name: "LANGFUSE_MIGRATION_V4_ALLOW_PREVIEW_OPT_IN", value: "true" },
    {
      name: "LANGFUSE_BACKGROUND_MIGRATION_V4_ENABLE_HISTORIC_BACKFILL",
      value: String(historicBackfill),
    },
  ];
}

export function langfuseDefaultMembershipEnv(
  lf: Pick<DeployConfig["langfuse"], "orgId" | "projectId" | "defaultRole">,
): k8s.types.input.core.v1.EnvVar[] {
  const org: k8s.types.input.core.v1.EnvVar[] = [
    { name: "LANGFUSE_DEFAULT_ORG_ID", value: lf.orgId },
    { name: "LANGFUSE_DEFAULT_ORG_ROLE", value: lf.defaultRole },
  ];
  if (lf.defaultRole === "NONE") return org;
  return [
    ...org,
    { name: "LANGFUSE_DEFAULT_PROJECT_ID", value: lf.projectId },
    { name: "LANGFUSE_DEFAULT_PROJECT_ROLE", value: lf.defaultRole },
  ];
}

const WEB_STARTUP_PERIOD_SECONDS = 10;
const WEB_STARTUP_FAILURE_THRESHOLD = 60;

export const LANGFUSE_SECRET_KEYS = {
  databaseUrl: "database-url",
  clickhousePassword: "clickhouse-password", // pragma: allowlist secret (Secret key name, not a credential)
  redisUrl: "redis-url",
  salt: "salt",
  encryptionKey: "encryption-key",
  nextAuthSecret: "nextauth-secret", // pragma: allowlist secret (Secret key name, not a credential)
  publicKey: "public-key",
  secretKey: "secret-key", // pragma: allowlist secret (Secret key name, not a credential)
  initUserPassword: "init-user-password", // pragma: allowlist secret (Secret key name, not a credential)
  s3AccessKey: "s3-access-key",
  s3SecretKey: "s3-secret-key", // pragma: allowlist secret (Secret key name, not a credential)
  oidcClientSecret: OIDC_CLIENT_SECRET_KEY,
  otlpBasicAuth: "otlp-basic-auth",
} as const;

export function langfuseOtlpTracesEndpoint(): string {
  return `${langfuseInClusterUrl()}${LANGFUSE.otlpTracesPath}`;
}

export function langfuseInClusterUrl(): string {
  return `http://${LANGFUSE.web}:${PORT.langfuseWeb}`;
}

export function frontendLangfuseEnv(cfg: DeployConfig): k8s.types.input.core.v1.EnvVar[] {
  if (!cfg.langfuse.enabled) return [];
  const fromSecret = (name: string, key: string): k8s.types.input.core.v1.EnvVar => ({
    name,
    valueFrom: { secretKeyRef: { name: SECRETS_NAME, key } },
  });
  return [
    { name: "LANGFUSE_HOST", value: langfuseInClusterUrl() },
    { name: "LANGFUSE_PUBLIC_URL", value: `https://${cfg.langfuse.domain}` },
    { name: "LANGFUSE_PROJECT_ID", value: cfg.langfuse.projectId },
    fromSecret("LANGFUSE_PUBLIC_KEY", LANGFUSE_SECRET_KEYS.publicKey),
    fromSecret("LANGFUSE_SECRET_KEY", LANGFUSE_SECRET_KEYS.secretKey),
  ];
}

export function withLangfuseKeysChecksum(
  cfg: DeployConfig,
  appChecksum: pulumi.Input<string>,
): pulumi.Input<string> {
  if (!cfg.langfuse.enabled) return appChecksum;
  return secretChecksum({ app: appChecksum, langfuse: langfuseOtlpBasicAuth(cfg) });
}

export function langfuseOtlpBasicAuth(cfg: DeployConfig): pulumi.Output<string> {
  return pulumi
    .all([cfg.langfuse.publicKey, cfg.langfuse.secretKey])
    .apply(([pk, sk]) => `Basic ${Buffer.from(`${pk}:${sk}`).toString("base64")}`);
}

export interface Langfuse {
  web: k8s.apps.v1.Deployment;
  worker: k8s.apps.v1.Deployment;
  webService: k8s.core.v1.Service;
  secret: k8s.core.v1.Secret;
  route: k8s.apiextensions.CustomResource;
  securityPolicy: k8s.apiextensions.CustomResource;
  otlpTracesEndpoint: pulumi.Output<string>;
}

export interface LangfuseInputs {
  databaseUrl: pulumi.Output<string>;
  clickhouseHttpUrl: pulumi.Output<string>;
  clickhouseMigrationUrl: pulumi.Output<string>;
  redisUrl: pulumi.Output<string>;
  s3Endpoint: pulumi.Output<string>;
}

export function installLangfuse(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  inputs: LangfuseInputs,
  dependsOn: pulumi.Resource[],
): Langfuse {
  const { langfuse: lf } = cfg;
  const publicUrl = `https://${lf.domain}`;

  assertStartupFitsRollout(
    "langfuse-web",
    ROLLOUT.langfuse,
    startupBudgetSeconds(WEB_STARTUP_PERIOD_SECONDS, WEB_STARTUP_FAILURE_THRESHOLD),
  );

  const secretValues: Record<string, pulumi.Input<string>> = {
    [LANGFUSE_SECRET_KEYS.databaseUrl]: inputs.databaseUrl,
    [LANGFUSE_SECRET_KEYS.clickhousePassword]: lf.clickhousePassword,
    [LANGFUSE_SECRET_KEYS.redisUrl]: inputs.redisUrl,
    [LANGFUSE_SECRET_KEYS.salt]: lf.salt,
    [LANGFUSE_SECRET_KEYS.encryptionKey]: lf.encryptionKey,
    [LANGFUSE_SECRET_KEYS.nextAuthSecret]: lf.nextAuthSecret,
    [LANGFUSE_SECRET_KEYS.publicKey]: lf.publicKey,
    [LANGFUSE_SECRET_KEYS.secretKey]: lf.secretKey,
    [LANGFUSE_SECRET_KEYS.initUserPassword]: lf.initUserPassword,
    [LANGFUSE_SECRET_KEYS.s3AccessKey]: lf.s3AccessKey,
    [LANGFUSE_SECRET_KEYS.s3SecretKey]: lf.s3SecretKey,
    [LANGFUSE_SECRET_KEYS.oidcClientSecret]: cfg.observability.oidcClientSecret,
    [LANGFUSE_SECRET_KEYS.otlpBasicAuth]: langfuseOtlpBasicAuth(cfg),
  };

  const secret = new k8s.core.v1.Secret(
    SECRETS_NAME,
    {
      metadata: { name: SECRETS_NAME, namespace, labels: commonLabels(LANGFUSE.web) },
      stringData: secretValues,
    },
    { provider, dependsOn },
  );

  const fromSecret = (key: string): k8s.types.input.core.v1.EnvVarSource => ({
    secretKeyRef: { name: SECRETS_NAME, key },
  });

  const sharedEnv: k8s.types.input.core.v1.EnvVar[] = [
    { name: "NEXTAUTH_URL", value: publicUrl }, // the worker's PostHog export builds `langfuse_url` from it
    { name: "DATABASE_URL", valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.databaseUrl) },
    { name: "SALT", valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.salt) },
    { name: "ENCRYPTION_KEY", valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.encryptionKey) },
    { name: "REDIS_CONNECTION_STRING", valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.redisUrl) },

    { name: "CLICKHOUSE_URL", value: inputs.clickhouseHttpUrl },
    { name: "CLICKHOUSE_MIGRATION_URL", value: inputs.clickhouseMigrationUrl },
    { name: "CLICKHOUSE_DB", value: LANGFUSE.clickhouseDatabase },
    { name: "CLICKHOUSE_USER", value: LANGFUSE.clickhouseUser },
    {
      name: "CLICKHOUSE_PASSWORD",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.clickhousePassword),
    },
    { name: "CLICKHOUSE_CLUSTER_ENABLED", value: "false" },

    { name: "LANGFUSE_S3_EVENT_UPLOAD_BUCKET", value: LANGFUSE.bucket },
    { name: "LANGFUSE_S3_EVENT_UPLOAD_PREFIX", value: LANGFUSE.eventPrefix },
    { name: "LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT", value: inputs.s3Endpoint },
    { name: "LANGFUSE_S3_EVENT_UPLOAD_REGION", value: "us-east-1" },
    {
      name: "LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.s3AccessKey),
    },
    {
      name: "LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.s3SecretKey),
    },
    { name: "LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE", value: "true" },

    { name: "LANGFUSE_S3_BATCH_EXPORT_ENABLED", value: "true" },
    { name: "LANGFUSE_S3_BATCH_EXPORT_BUCKET", value: LANGFUSE.bucket },
    { name: "LANGFUSE_S3_BATCH_EXPORT_PREFIX", value: LANGFUSE.batchExportPrefix },
    { name: "LANGFUSE_S3_BATCH_EXPORT_ENDPOINT", value: inputs.s3Endpoint },
    { name: "LANGFUSE_S3_BATCH_EXPORT_REGION", value: "us-east-1" },
    {
      name: "LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.s3AccessKey),
    },
    {
      name: "LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.s3SecretKey),
    },
    { name: "LANGFUSE_S3_BATCH_EXPORT_FORCE_PATH_STYLE", value: "true" },

    { name: "TELEMETRY_ENABLED", value: "false" },
    { name: "LANGFUSE_LOG_LEVEL", value: "info" },

    ...langfuseV4MigrationEnv(lf.v4HistoricBackfill),
  ];

  const initEnv: k8s.types.input.core.v1.EnvVar[] = [
    { name: "LANGFUSE_INIT_ORG_ID", value: lf.orgId },
    { name: "LANGFUSE_INIT_ORG_NAME", value: "Grid" },
    { name: "LANGFUSE_INIT_PROJECT_ID", value: lf.projectId },
    { name: "LANGFUSE_INIT_PROJECT_NAME", value: "Grid OIB" },
    {
      name: "LANGFUSE_INIT_PROJECT_PUBLIC_KEY",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.publicKey),
    },
    {
      name: "LANGFUSE_INIT_PROJECT_SECRET_KEY",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.secretKey),
    },
    { name: "LANGFUSE_INIT_USER_EMAIL", value: lf.initUserEmail },
    { name: "LANGFUSE_INIT_USER_NAME", value: "Grid Platform" },
    {
      name: "LANGFUSE_INIT_USER_PASSWORD",
      valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.initUserPassword),
    },
  ];

  const hardened: k8s.types.input.core.v1.SecurityContext = {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: false,
    capabilities: { drop: ["ALL"] },
  };
  const podSecurity: k8s.types.input.core.v1.PodSecurityContext = {
    runAsNonRoot: true,
    runAsUser: LANGFUSE_IMAGE_UID,
    runAsGroup: LANGFUSE_IMAGE_UID,
  };

  const webShutdown = gracefulShutdown(ROLLOUT.langfuse, "node");
  const webLabels = commonLabels(LANGFUSE.web);
  const web = new k8s.apps.v1.Deployment(
    LANGFUSE.web,
    {
      metadata: { name: LANGFUSE.web, namespace, labels: webLabels },
      spec: {
        replicas: 1,
        ...recreateRollout(ROLLOUT.langfuse),
        selector: { matchLabels: webLabels },
        template: {
          metadata: {
            labels: webLabels,
            annotations: secretChecksumAnnotations(secretChecksum(secretValues)),
          },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            securityContext: podSecurity,
            terminationGracePeriodSeconds: webShutdown.terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "langfuse-web",
                image: lf.webImage,
                imagePullPolicy: pullPolicyFor(lf.webImage),
                securityContext: hardened,
                ...(webShutdown.lifecycle ? { lifecycle: webShutdown.lifecycle } : {}),
                ports: [{ containerPort: PORT.langfuseWeb, name: "http" }],
                env: [
                  ...sharedEnv,
                  ...initEnv,
                  { name: "PORT", value: String(PORT.langfuseWeb) },
                  { name: "HOSTNAME", value: "0.0.0.0" },
                  {
                    name: "NEXTAUTH_SECRET",
                    valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.nextAuthSecret),
                  },
                  { name: "AUTH_CUSTOM_NAME", value: "WorkOS" },
                  { name: "AUTH_CUSTOM_ISSUER", value: cfg.observability.oidcIssuer },
                  { name: "AUTH_CUSTOM_CLIENT_ID", value: cfg.observability.oidcClientId },
                  {
                    name: "AUTH_CUSTOM_CLIENT_SECRET",
                    valueFrom: fromSecret(LANGFUSE_SECRET_KEYS.oidcClientSecret),
                  },
                  { name: "AUTH_CUSTOM_SCOPE", value: "openid profile email" },
                  { name: "AUTH_CUSTOM_ALLOW_ACCOUNT_LINKING", value: "true" },
                  ...langfuseDefaultMembershipEnv(lf),
                  { name: "AUTH_TRUST_HOST", value: "true" },
                ],
                resources: LANGFUSE.webResources,
                startupProbe: {
                  httpGet: { path: "/api/public/health", port: PORT.langfuseWeb },
                  periodSeconds: WEB_STARTUP_PERIOD_SECONDS,
                  failureThreshold: WEB_STARTUP_FAILURE_THRESHOLD,
                },
                readinessProbe: {
                  httpGet: { path: "/api/public/health", port: PORT.langfuseWeb },
                  periodSeconds: 15,
                  timeoutSeconds: 5,
                },
                livenessProbe: {
                  httpGet: { path: "/api/public/health", port: PORT.langfuseWeb },
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                  failureThreshold: 6,
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, secret] },
  );

  const webService = new k8s.core.v1.Service(
    LANGFUSE.web,
    {
      metadata: { name: LANGFUSE.web, namespace, labels: webLabels },
      spec: {
        selector: webLabels,
        ports: [{ port: PORT.langfuseWeb, targetPort: PORT.langfuseWeb, name: "http" }],
      },
    },
    { provider, dependsOn: web },
  );

  const workerLabels = commonLabels(LANGFUSE.worker);
  const worker = new k8s.apps.v1.Deployment(
    LANGFUSE.worker,
    {
      metadata: { name: LANGFUSE.worker, namespace, labels: workerLabels },
      spec: {
        replicas: 1,
        ...recreateRollout(ROLLOUT.langfuse),
        selector: { matchLabels: workerLabels },
        template: {
          metadata: {
            labels: workerLabels,
            annotations: secretChecksumAnnotations(secretChecksum(secretValues)),
          },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            securityContext: podSecurity,
            terminationGracePeriodSeconds:
              gracefulShutdown(ROLLOUT.langfuse).terminationGracePeriodSeconds,
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "langfuse-worker",
                image: lf.workerImage,
                imagePullPolicy: pullPolicyFor(lf.workerImage),
                securityContext: hardened,
                ports: [{ containerPort: PORT.langfuseWorker, name: "http" }],
                env: [
                  ...sharedEnv,
                  { name: "PORT", value: String(PORT.langfuseWorker) },
                  { name: "HOSTNAME", value: "0.0.0.0" },
                  { name: "LANGFUSE_AUTO_POSTGRES_MIGRATION_DISABLED", value: "true" },
                  { name: "LANGFUSE_AUTO_CLICKHOUSE_MIGRATION_DISABLED", value: "true" },
                ],
                resources: LANGFUSE.workerResources,
                startupProbe: {
                  httpGet: { path: "/api/health", port: PORT.langfuseWorker },
                  periodSeconds: 10,
                  failureThreshold: 30,
                },
                readinessProbe: {
                  httpGet: { path: "/api/health", port: PORT.langfuseWorker },
                  periodSeconds: 15,
                  timeoutSeconds: 5,
                },
                livenessProbe: {
                  httpGet: { path: "/api/health", port: PORT.langfuseWorker },
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                  failureThreshold: 6,
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, secret, web] },
  );

  const routeSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: LANGFUSE.listenerName }],
    hostnames: [lf.domain],
    rules: [
      {
        backendRefs: [{ name: LANGFUSE.web, port: PORT.langfuseWeb }],
        timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT },
      },
    ],
  };
  const route = new k8s.apiextensions.CustomResource(
    logicalName("grid-langfuse-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: LANGFUSE.routeName, namespace, labels: webLabels },
      spec: routeSpec,
    },
    { provider, dependsOn: webService },
  );

  const securityPolicy = new k8s.apiextensions.CustomResource(
    logicalName("grid-langfuse-security-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "SecurityPolicy",
      metadata: { name: objectName("langfuseAuth"), namespace, labels: webLabels },
      spec: platformOidcSecurityPolicySpec(cfg, {
        routeName: LANGFUSE.routeName,
        domain: lf.domain,
        secretName: SECRETS_NAME,
        alsoAdmit: [OBSERVABILITY_VIEW_PERMISSION],
      }),
    },
    { provider, dependsOn: [route, secret] },
  );

  return {
    web,
    worker,
    webService,
    secret,
    route,
    securityPolicy,
    otlpTracesEndpoint: pulumi.output(langfuseOtlpTracesEndpoint()),
  };
}
