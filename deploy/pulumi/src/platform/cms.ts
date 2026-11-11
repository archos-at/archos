/**
 * The website's CMS (ADR-0155): Payload in namespace `cms`, behind its own host
 * `cms.<baseDomain>`, which is gated like Langfuse's: platform staff only, and
 * the CMS signs them in from the gate's token (slice 11). Its images are the one
 * path open to everyone, because the website's visitors load them. Agents reach
 * its MCP server through the platform MCP gateway at `/cms/mcp`. It runs on `cms-pg` (`data/cms-pg.ts`), its files in the SeaweedFS bucket
 * `cms-files` through the `cms` identity. Its collections, rules and hooks are
 * code in apps/cms, built into the image `cms` by CI like the other apps.
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
import { MCP_GATEWAY } from "./mcp-gateway-config";
import { OIDC_CLIENT_SECRET_KEY, platformOidcSecurityPolicySpec } from "./platform-oidc";
import { commonLabels } from "./namespaces";
import { onNodeGroup } from "./scheduling";
import { hardenedContainerSecurityContext } from "./security";

/** The CMS inside the cluster: what the website dials. */
export const CMS_INTERNAL_URL = `http://${CMS.app}.${CMS.namespace}.svc.cluster.local:${CMS.port}`;
/** The website's revalidate endpoint, which the CMS calls when what is live changes. */
export const WEBSITE_REVALIDATE_PATH = "/api/cms/revalidate";
/** The probe path (apps/cms/src/app/healthz/route.ts): answers once the server listens, touches no database. */
export const CMS_HEALTH_PATH = "/healthz";
/**
 * The CMS's images (Payload's `/api/media/file/<name>`): the one path of the
 * CMS host the website's anonymous visitors load, so its route is not gated.
 */
export const CMS_PUBLIC_MEDIA_PATH = "/api/media/file/";
/** The Connect application's client secret, beside the CMS's SecurityPolicy (a Secret reference cannot cross namespaces). */
export const CMS_OIDC_SECRET = "cms-oidc"; // pragma: allowlist secret (a Secret's name)
/** In the app namespace: the `Authorization` header the platform MCP gateway presents at `/cms/mcp`. */
export const CMS_GATEWAY_CREDENTIAL_SECRET = "cms-platform-mcp"; // pragma: allowlist secret (a Secret's name)
export const CMS_GATEWAY_CREDENTIAL_KEY = "authorization"; // pragma: allowlist secret (a Secret key's name)
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
    // The issuer of the token the edge gate forwards; the CMS signs the person in from it (apps/cms/src/auth/edge.ts).
    CMS_EDGE_OIDC_ISSUER: cfg.observability.oidcIssuer,
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
        ...(cfg.mcpGateway.enabled ? { CMS_PLATFORM_MCP_API_KEY: cfg.cms.platformMcpApiKey } : {}),
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
  /** The namespace, the cluster, the bucket-init Job, and the pull Secret when there is one. */
  dependsOn: pulumi.Resource[],
  /** The registry pull Secret in the CMS's namespace, when the images are private. */
  imagePullSecrets: { name: string }[] = [],
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
            imagePullSecrets,
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

const cmsBackend = { backendRefs: [{ name: CMS.app, port: CMS.port }] };

/**
 * `cms.<baseDomain>` to the CMS's Service, in two routes. Everything is behind
 * the platform gate (`platformOidcSecurityPolicySpec`, the one in front of
 * Langfuse): only WorkOS identities holding the platform permission reach the
 * admin panel or the API, and the CMS signs them in from the token the gate
 * forwards. The images alone are open, on a route of their own, because the
 * website's visitors load them from this host; the longer path prefix wins.
 */
export function installCmsRoute(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
  const parentRefs = [{ name: GATEWAY_NAME, namespace: appNamespace, sectionName: CMS.listenerName }];
  const labels = commonLabels(CMS.app);
  const route = (name: string, spec: IHTTPRouteSpec) =>
    new k8s.apiextensions.CustomResource(
      `${name}-route`,
      { apiVersion: "gateway.networking.k8s.io/v1", kind: "HTTPRoute", metadata: { name, namespace: CMS.namespace, labels }, spec },
      { provider, dependsOn },
    );
  const gated = route(CMS.routeName, {
    parentRefs,
    hostnames: [cfg.cms.domain],
    // An upload outlasts Envoy's 15 s default.
    rules: [{ ...cmsBackend, timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT } }],
  });
  const media = route(CMS.mediaRouteName, {
    parentRefs,
    hostnames: [cfg.cms.domain],
    rules: [{ matches: [{ path: { type: "PathPrefix", value: CMS_PUBLIC_MEDIA_PATH } }], ...cmsBackend }],
  });
  const secret = new k8s.core.v1.Secret(
    CMS_OIDC_SECRET,
    { metadata: { name: CMS_OIDC_SECRET, namespace: CMS.namespace, labels }, stringData: { [OIDC_CLIENT_SECRET_KEY]: cfg.observability.oidcClientSecret } },
    { provider, dependsOn },
  );
  const policy = new k8s.apiextensions.CustomResource(
    "cms-security-policy",
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "SecurityPolicy",
      metadata: { name: "cms-auth", namespace: CMS.namespace, labels },
      spec: platformOidcSecurityPolicySpec(cfg, { routeName: CMS.routeName, domain: cfg.cms.domain, secretName: CMS_OIDC_SECRET }),
    },
    { provider, dependsOn: [gated, secret] },
  );
  return { gated, media, policy };
}

/**
 * The header the platform MCP gateway presents at `/cms/mcp`: the CMS's MCP key
 * of its agent account, in the gateway's namespace (it mounts the one key).
 * Only while the gateway runs.
 */
export function installCmsGatewayCredential(cfg: DeployConfig, provider: k8s.Provider, appNamespace: pulumi.Input<string>, dependsOn: pulumi.Resource[]) {
  if (!cfg.cms.enabled || !cfg.mcpGateway.enabled) return undefined;
  return new k8s.core.v1.Secret(
    CMS_GATEWAY_CREDENTIAL_SECRET,
    {
      metadata: { name: CMS_GATEWAY_CREDENTIAL_SECRET, namespace: appNamespace, labels: commonLabels(MCP_GATEWAY.name) },
      stringData: { [CMS_GATEWAY_CREDENTIAL_KEY]: pulumi.interpolate`Bearer ${cfg.cms.platformMcpApiKey}` },
    },
    { provider, dependsOn },
  );
}

/**
 * Default-deny ingress in `cms`, and the ways in: the edge to the CMS, the
 * website to the CMS, the platform MCP gateway to the CMS while it runs, the
 * CloudNativePG operator to the cluster, and the namespace's own pods (the CMS
 * to `cms-pg`). In the app namespace, the CMS may
 * reach the SeaweedFS S3 port and the website.
 */
export function installCmsNetworkPolicies(cfg: DeployConfig, provider: k8s.Provider, appNamespace: string, dependsOn: pulumi.Resource[]) {
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
    // The platform MCP gateway to the CMS's MCP server (`/cms/mcp`), while it runs.
    ...(cfg.mcpGateway.enabled
      ? [
          mk("allow-platform-mcp-gateway-to-cms", CMS.namespace, {
            ...cms,
            policyTypes: ["Ingress"],
            ingress: [{ from: [{ ...inNamespace(appNamespace), ...byName(MCP_GATEWAY.name) }], ports: http }],
          }),
        ]
      : []),
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
