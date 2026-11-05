/**
 * The website's CMS (ADR-0155): Payload in namespace `cms`, behind its own host
 * `cms.<baseDomain>` (the admin panel, the REST API, and the MCP server at
 * `/api/mcp`), on `cms-pg` (`data/cms-pg.ts`), its files in the SeaweedFS bucket
 * `cms-files` through the `cms` identity. Its collections, rules and hooks are
 * code in apps/cms, built into the image `grid-oib-cms` by CI like the other apps.
 *
 * One replica, replaced with `Recreate`: Payload applies its migrations when a
 * production server starts (`prodMigrations`), and two versions must not do that
 * at once; it also runs the jobs queue (scheduled publishing, the LinkedIn
 * drafts) in process. The website does not wait on it: it serves its cached
 * posts while the CMS restarts.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { DeployConfig } from "../config";
import { CMS, cmsImage } from "../config/cms";
import { appPullPolicy } from "../config/images";
import { CMS_PG_CA_SECRET, CMS_PG_HOST } from "../data/cms-pg";
import { EDGE_TIMEOUT, PORT } from "../constants";
import { GATEWAY_NAME } from "./gateway";
import { commonLabels } from "./namespaces";
import { onNodeGroup } from "./scheduling";
import { hardenedContainerSecurityContext } from "./security";

/** The CMS inside the cluster: what the website dials. */
export const CMS_INTERNAL_URL = `http://${CMS.app}.${CMS.namespace}.svc.cluster.local:${CMS.port}`;
/** The website's revalidate endpoint, which the CMS calls when what is live changes. */
export const WEBSITE_REVALIDATE_PATH = "/api/cms/revalidate";
/** The probe path (apps/cms/src/app/healthz/route.ts): answers once the server listens, touches no database. */
export const CMS_HEALTH_PATH = "/healthz";
/** Where the pod reads `cms-pg`'s CA; DATABASE_URL names it (`sslrootcert`). */
const PG_CA_PATH = "/etc/cms-pg-ca/ca.crt";

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

/** The CMS's environment, without the secrets (`cmsSecret`). */
export function cmsEnv(cfg: DeployConfig, appNamespace: string): Record<string, string> {
  return {
    NODE_ENV: "production",
    PORT: String(CMS.port),
    HOSTNAME: "0.0.0.0",
    CMS_PUBLIC_URL: `https://${cfg.cms.domain}`,
    DATABASE_POOL_MAX: String(CMS.poolMax),
    CMS_S3_BUCKET: CMS.bucket,
    CMS_S3_ACCESS_KEY_ID: cfg.cms.s3AccessKey,
    CMS_S3_REGION: "us-east-1",
    CMS_S3_ENDPOINT: `http://seaweedfs.${appNamespace}.svc.cluster.local:${PORT.seaweedS3}`,
    CMS_ADMIN_EMAIL: cfg.cms.adminEmail,
    WEBSITE_REVALIDATE_URL: `http://web.${appNamespace}.svc.cluster.local:${PORT.web}${WEBSITE_REVALIDATE_PATH}`,
    // Where an editor's browser reaches the website: the live preview frames it.
    WEBSITE_PUBLIC_URL: `https://${cfg.ingress.webDomain}`,
  };
}

/** `cms-pg`'s owner, verified against the cluster's CA (CloudNativePG's certificate names `cms-pg-rw.cms.svc`). */
export function cmsDatabaseUrl(password: pulumi.Input<string>): pulumi.Output<string> {
  return pulumi.interpolate`postgresql://${CMS.owner}:${pulumi.output(password).apply(encodeURIComponent)}@${CMS_PG_HOST}:${PORT.postgres}/${CMS.database}?sslmode=verify-full&sslrootcert=${PG_CA_PATH}`;
}

/** The Secret the CMS reads its credentials from. */
function cmsSecret(cfg: DeployConfig, provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret(
    "cms-env",
    {
      metadata: { name: "cms-env", namespace: CMS.namespace },
      stringData: {
        PAYLOAD_SECRET: cfg.cms.secret,
        DATABASE_URL: cmsDatabaseUrl(cfg.cms.postgres.password),
        CMS_S3_SECRET_ACCESS_KEY: cfg.cms.s3SecretKey,
        CMS_ADMIN_PASSWORD: cfg.cms.adminPassword,
        CMS_WEBSITE_API_KEY: cfg.cms.websiteApiKey,
        CMS_SOCIAL_HANDOFF_API_KEY: cfg.cms.socialHandoffApiKey,
        WEBSITE_REVALIDATE_TOKEN: cfg.cms.revalidateToken,
        CMS_PREVIEW_SECRET: cfg.cms.previewSecret,
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
  const probe = { httpGet: { path: CMS_HEALTH_PATH, port: CMS.port } };
  const image = cmsImage(cfg.images, cfg.cms.imageOverride);
  const deployment = new k8s.apps.v1.Deployment(
    CMS.app,
    {
      metadata: { name: CMS.app, namespace, labels },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        // The policy pack's soak; Recreate is allowed for a declared singleton.
        minReadySeconds: 10,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            // Requests are short; an MCP call or an upload in flight gets 30 s to finish.
            terminationGracePeriodSeconds: 30,
            securityContext: { runAsNonRoot: true, runAsUser: CMS.uid, runAsGroup: CMS.uid, seccompProfile: { type: "RuntimeDefault" } },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: CMS.app,
                image,
                imagePullPolicy: appPullPolicy(cfg, image),
                securityContext: { ...hardenedContainerSecurityContext(), readOnlyRootFilesystem: true },
                ports: [{ containerPort: CMS.port, name: "http" }],
                env: Object.entries(cmsEnv(cfg, appNamespace)).map(([name, value]) => ({ name, value })),
                envFrom: [{ secretRef: { name: secret.metadata.name } }],
                resources: cfg.cms.resources,
                volumeMounts: [
                  { name: "pg-ca", mountPath: "/etc/cms-pg-ca", readOnly: true },
                  // Next's own cache and sharp's temporary files; nothing else is written to disk.
                  { name: "next-cache", mountPath: "/app/.next/cache" },
                  { name: "tmp", mountPath: "/tmp" },
                ],
                // Payload migrates before the server answers: give it time.
                startupProbe: { ...probe, periodSeconds: 5, failureThreshold: 60 },
                readinessProbe: { ...probe, periodSeconds: 10 },
                livenessProbe: { ...probe, periodSeconds: 20, failureThreshold: 5 },
              },
            ],
            volumes: [
              { name: "pg-ca", secret: { secretName: CMS_PG_CA_SECRET, items: [{ key: "ca.crt", path: "ca.crt" }] } },
              { name: "next-cache", emptyDir: { sizeLimit: "256Mi" } },
              { name: "tmp", emptyDir: { sizeLimit: "256Mi" } },
            ],
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

/** `cms.<baseDomain>` to the CMS's Service: the admin panel, the API and `/api/mcp`. The CMS signs people in itself. */
export function installCmsRoute(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  const spec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, namespace: appNamespace, sectionName: CMS.listenerName }],
    hostnames: [cfg.cms.domain],
    rules: [
      {
        backendRefs: [{ name: CMS.app, port: CMS.port }],
        // An MCP call and a large upload outlast Envoy's 15 s default.
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
 * Default-deny ingress in `cms`, and the four ways in: the edge to the CMS, the
 * website to the CMS, the CloudNativePG operator to the cluster, and the
 * namespace's own pods (the CMS to `cms-pg`). In the app namespace, the CMS may
 * reach the SeaweedFS S3 port and the website.
 */
export function installCmsNetworkPolicies(provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  const mk = (name: string, namespace: string, spec: k8s.types.input.networking.v1.NetworkPolicySpec) =>
    new k8s.networking.v1.NetworkPolicy(`cms-${namespace === CMS.namespace ? "" : "app-"}${name}`, { metadata: { name, namespace }, spec }, { provider, dependsOn });
  const cms = byName(CMS.app);
  const http = [{ protocol: "TCP", port: CMS.port }];
  return [
    mk("default-deny-ingress", CMS.namespace, { podSelector: {}, policyTypes: ["Ingress"] }),
    mk("allow-same-namespace", CMS.namespace, { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ podSelector: {} }] }] }),
    mk("allow-cnpg-operator", CMS.namespace, {
      podSelector: { matchLabels: { "cnpg.io/cluster": CMS.cluster } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [inNamespace("cnpg-system")] }],
    }),
    mk("allow-edge-to-cms", CMS.namespace, { ...cms, policyTypes: ["Ingress"], ingress: [{ from: [inNamespace("envoy-gateway-system")], ports: http }] }),
    mk("allow-website-to-cms", CMS.namespace, {
      ...cms,
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(appNamespace), ...byName("web") }], ports: http }],
    }),
    mk("allow-cms-to-seaweedfs", appNamespace, {
      ...byName("seaweedfs"),
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(CMS.namespace), ...cms }], ports: [{ protocol: "TCP", port: PORT.seaweedS3 }] }],
    }),
    mk("allow-cms-to-website", appNamespace, {
      ...byName("web"),
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ ...inNamespace(CMS.namespace), ...cms }], ports: [{ protocol: "TCP", port: PORT.web }] }],
    }),
  ];
}

/**
 * The website's side: where the CMS is and the two credentials it uses (its API
 * key, and the bearer it accepts from the CMS), in a Secret of the app namespace. Without the CMS, nothing: the website then
 * serves the posts it was built with (apps/website, its fixture fallback).
 */
export function installWebCmsSecret(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  if (!cfg.cms.enabled) return undefined;
  return new k8s.core.v1.Secret(
    "web-cms",
    {
      metadata: { name: WEB_CMS_SECRET, namespace: appNamespace },
      stringData: { CMS_API_KEY: cfg.cms.websiteApiKey, CMS_REVALIDATE_TOKEN: cfg.cms.revalidateToken },
    },
    { provider, dependsOn },
  );
}

export const WEB_CMS_SECRET = "web-cms"; // pragma: allowlist secret

/** The website's CMS env: the URLs inline, the credentials from `web-cms`. Empty without the CMS. */
export function webCmsEnv(cfg: DeployConfig): k8s.types.input.core.v1.EnvVar[] {
  if (!cfg.cms.enabled) return [];
  const fromSecret = (name: string) => ({ name, valueFrom: { secretKeyRef: { name: WEB_CMS_SECRET, key: name } } });
  return [
    { name: "CMS_URL", value: CMS_INTERNAL_URL },
    { name: "CMS_PUBLIC_URL", value: `https://${cfg.cms.domain}` },
    fromSecret("CMS_API_KEY"),
    fromSecret("CMS_REVALIDATE_TOKEN"),
  ];
}
