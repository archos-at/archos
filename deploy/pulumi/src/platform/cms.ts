/**
 * The website's CMS (ADR-0155): Directus in namespace `cms`, behind its own
 * host `cms.<baseDomain>` (the Studio, the REST and GraphQL API, and the MCP
 * server at `/mcp`), on `cms-pg` (`data/cms-pg.ts`), its files in the SeaweedFS
 * bucket `cms-files` through the `cms` identity. Its schema, roles, flows and
 * settings arrive by the config Job (`cms-config-job.ts`) from the sync files in
 * `apps/cms/directus`.
 *
 * One replica, replaced with `Recreate`: Directus migrates its own schema at
 * start (`directus bootstrap`), and two versions must not do that at once. The
 * website does not wait on it: it serves its cached pages while the CMS
 * restarts. More replicas need a shared cache and synchronization store
 * (Directus' `CACHE_STORE`/`SYNCHRONIZATION_STORE`), the ADR's later slice.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { DeployConfig } from "../config";
import { CMS } from "../config/cms";
import { CMS_PG_CA_SECRET, CMS_PG_HOST } from "../data/cms-pg";
import { EDGE_TIMEOUT, PORT } from "../constants";
import { GATEWAY_NAME } from "./gateway";
import { commonLabels } from "./namespaces";
import { onNodeGroup } from "./scheduling";
import { hardenedContainerSecurityContext } from "./security";

/** The CMS inside the cluster: what the website and the config Job dial. */
export const CMS_INTERNAL_URL = `http://${CMS.app}.${CMS.namespace}.svc.cluster.local:${CMS.port}`;
/** The website's revalidate endpoint, which the `Refresh the website` flow calls. */
export const WEBSITE_REVALIDATE_PATH = "/api/cms/revalidate";
/** The probe path: `/server/ping` answers without a token (`/server/health` does not). */
export const CMS_PING_PATH = "/server/ping";

const byName = (name: string) => ({ podSelector: { matchLabels: { "app.kubernetes.io/name": name } } });
const inNamespace = (ns: pulumi.Input<string>) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ns } },
});

/** Its own namespace, at the `restricted` Pod Security Standard: nothing in it needs more. */
export function installCmsNamespace(provider: k8s.Provider): k8s.core.v1.Namespace {
  return new k8s.core.v1.Namespace(
    "cms-ns",
    {
      metadata: {
        name: CMS.namespace,
        labels: {
          ...(commonLabels("cms") as Record<string, string>),
          "pod-security.kubernetes.io/enforce": "restricted",
          "pod-security.kubernetes.io/warn": "restricted",
          "pod-security.kubernetes.io/audit": "restricted",
        },
      },
    },
    { provider },
  );
}

/** Directus' environment, without the secrets (`cmsSecretEnv`). */
export function cmsEnv(cfg: DeployConfig, appNamespace: string): Record<string, string> {
  return {
    PUBLIC_URL: `https://${cfg.cms.domain}`,
    PORT: String(CMS.port),
    HOST: "0.0.0.0",
    LOG_STYLE: "raw",
    TELEMETRY: "false",
    DB_CLIENT: "pg",
    DB_HOST: CMS_PG_HOST,
    DB_PORT: String(PORT.postgres),
    DB_DATABASE: CMS.database,
    DB_USER: CMS.owner,
    DB_SSL__CA_FILE: "/etc/cms-pg-ca/ca.crt",
    DB_POOL__MAX: String(CMS.poolMax),
    STORAGE_LOCATIONS: "s3",
    STORAGE_S3_DRIVER: "s3",
    STORAGE_S3_KEY: cfg.cms.s3AccessKey,
    STORAGE_S3_BUCKET: CMS.bucket,
    STORAGE_S3_REGION: "us-east-1",
    STORAGE_S3_ENDPOINT: `http://seaweedfs.${appNamespace}.svc.cluster.local:${PORT.seaweedS3}`,
    STORAGE_S3_FORCE_PATH_STYLE: "true",
    ADMIN_EMAIL: cfg.cms.adminEmail,
    RATE_LIMITER_ENABLED: "true",
    RATE_LIMITER_STORE: "memory",
    // The website reads server-side; no browser calls the API across origins.
    CORS_ENABLED: "false",
    // Flows may read only these two variables (Directus redacts them in the run log).
    FLOWS_ENV_ALLOW_LIST: "WEBSITE_REVALIDATE_URL,WEBSITE_REVALIDATE_TOKEN",
    WEBSITE_REVALIDATE_URL: `http://web.${appNamespace}.svc.cluster.local:${PORT.web}${WEBSITE_REVALIDATE_PATH}`,
  };
}

/** The Secret Directus reads its credentials from. */
function cmsSecret(cfg: DeployConfig, provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret(
    "cms-env",
    {
      metadata: { name: "cms-env", namespace: CMS.namespace },
      stringData: {
        SECRET: cfg.cms.secret,
        LICENSE_KEY: cfg.cms.licenseKey,
        ADMIN_PASSWORD: cfg.cms.adminPassword,
        ADMIN_TOKEN: cfg.cms.adminToken,
        DB_PASSWORD: cfg.cms.postgres.password,
        STORAGE_S3_SECRET: cfg.cms.s3SecretKey,
        WEBSITE_REVALIDATE_TOKEN: cfg.cms.revalidateToken,
      },
    },
    { provider, dependsOn },
  );
}

export interface Cms {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
}

export function installCms(
  cfg: DeployConfig,
  provider: k8s.Provider,
  appNamespace: string,
  /** The namespace, the cluster, and the bucket-init Job. */
  dependsOn: pulumi.Resource[],
): Cms {
  const namespace = CMS.namespace;
  const labels = commonLabels(CMS.app);
  const secret = cmsSecret(cfg, provider, dependsOn);
  const probe = { httpGet: { path: CMS_PING_PATH, port: CMS.port } };
  const deployment = new k8s.apps.v1.Deployment(
    CMS.app,
    {
      metadata: { name: CMS.app, namespace, labels },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            securityContext: { runAsNonRoot: true, runAsUser: CMS.uid, runAsGroup: CMS.uid, seccompProfile: { type: "RuntimeDefault" } },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: CMS.app,
                image: cfg.cms.image,
                securityContext: hardenedContainerSecurityContext(),
                ports: [{ containerPort: CMS.port, name: "http" }],
                env: Object.entries(cmsEnv(cfg, appNamespace)).map(([name, value]) => ({ name, value })),
                envFrom: [{ secretRef: { name: secret.metadata.name } }],
                resources: cfg.cms.resources,
                volumeMounts: [{ name: "pg-ca", mountPath: "/etc/cms-pg-ca", readOnly: true }],
                // `directus bootstrap` migrates before the server listens: give it time.
                startupProbe: { ...probe, periodSeconds: 5, failureThreshold: 60 },
                readinessProbe: { ...probe, periodSeconds: 10 },
                livenessProbe: { ...probe, periodSeconds: 20, failureThreshold: 5 },
              },
            ],
            volumes: [{ name: "pg-ca", secret: { secretName: CMS_PG_CA_SECRET, items: [{ key: "ca.crt", path: "ca.crt" }] } }],
          },
        },
      },
    },
    { provider, dependsOn: [secret, ...dependsOn], customTimeouts: { create: "15m", update: "15m" } },
  );
  const service = new k8s.core.v1.Service(
    CMS.app,
    {
      metadata: { name: CMS.app, namespace, labels },
      spec: { selector: labels, ports: [{ port: CMS.port, targetPort: CMS.port, name: "http" }] },
    },
    { provider, dependsOn: deployment },
  );
  return { deployment, service };
}

/** `cms.<baseDomain>` to the Directus Service: the Studio, the API and `/mcp`. Directus signs people in itself. */
export function installCmsRoute(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  const spec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, namespace: appNamespace, sectionName: CMS.listenerName }],
    hostnames: [cfg.cms.domain],
    rules: [
      {
        backendRefs: [{ name: CMS.app, port: CMS.port }],
        // An MCP session and a large upload outlast Envoy's 15 s default.
        timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT },
      },
    ],
  };
  return new k8s.apiextensions.CustomResource(
    "cms-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: CMS.routeName, namespace: CMS.namespace, labels: commonLabels(CMS.app) },
      spec,
    },
    { provider, dependsOn },
  );
}

/**
 * Default-deny ingress in `cms`, and the four ways in: the edge to Directus, the
 * website to Directus, the CloudNativePG operator to the cluster, and the
 * namespace's own pods (Directus to `cms-pg`, the config Job to Directus). In
 * the app namespace, Directus may reach the SeaweedFS S3 port and the website.
 */
export function installCmsNetworkPolicies(provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  const mk = (name: string, namespace: string, spec: k8s.types.input.networking.v1.NetworkPolicySpec) =>
    new k8s.networking.v1.NetworkPolicy(`cms-${namespace === CMS.namespace ? "" : "app-"}${name}`, { metadata: { name, namespace }, spec }, { provider, dependsOn });
  const directus = byName(CMS.app);
  const http = [{ protocol: "TCP", port: CMS.port }];
  return [
    mk("default-deny-ingress", CMS.namespace, { podSelector: {}, policyTypes: ["Ingress"] }),
    mk("allow-same-namespace", CMS.namespace, { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: {} }] }] }),
    mk("allow-cnpg-operator", CMS.namespace, {
      podSelector: { matchLabels: { "cnpg.io/cluster": CMS.cluster } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [inNamespace("cnpg-system")] }],
    }),
    mk("allow-edge-to-directus", CMS.namespace, { ...directus, policyTypes: ["Ingress"], ingress: [{ from: [inNamespace("envoy-gateway-system")], ports: http }] }),
    mk("allow-website-to-directus", CMS.namespace, {
      ...directus,
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(appNamespace), ...byName("web") }], ports: http }],
    }),
    mk("allow-cms-to-seaweedfs", appNamespace, {
      ...byName("seaweedfs"),
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(CMS.namespace), ...directus }], ports: [{ protocol: "TCP", port: PORT.seaweedS3 }] }],
    }),
    mk("allow-cms-to-website", appNamespace, {
      ...byName("web"),
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(CMS.namespace), ...directus }], ports: [{ protocol: "TCP", port: PORT.web }] }],
    }),
  ];
}

/**
 * The website's side: where the CMS is and the two credentials it uses, in a
 * Secret of the app namespace. Without the CMS, nothing: the website then
 * serves the posts it was built with (apps/website, its fixture fallback).
 */
export function installWebCmsSecret(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  if (!cfg.cms.enabled) return undefined;
  return new k8s.core.v1.Secret(
    "web-cms",
    {
      metadata: { name: WEB_CMS_SECRET, namespace: appNamespace },
      stringData: { CMS_TOKEN: cfg.cms.websiteToken, CMS_REVALIDATE_TOKEN: cfg.cms.revalidateToken },
    },
    { provider, dependsOn },
  );
}

export const WEB_CMS_SECRET = "web-cms"; // pragma: allowlist secret

/** The website's CMS env: the URLs inline, the tokens from `web-cms`. Empty without the CMS. */
export function webCmsEnv(cfg: DeployConfig): k8s.types.input.core.v1.EnvVar[] {
  if (!cfg.cms.enabled) return [];
  const fromSecret = (name: string) => ({ name, valueFrom: { secretKeyRef: { name: WEB_CMS_SECRET, key: name } } });
  return [
    { name: "CMS_URL", value: CMS_INTERNAL_URL },
    { name: "CMS_PUBLIC_URL", value: `https://${cfg.cms.domain}` },
    fromSecret("CMS_TOKEN"),
    fromSecret("CMS_REVALIDATE_TOKEN"),
  ];
}
