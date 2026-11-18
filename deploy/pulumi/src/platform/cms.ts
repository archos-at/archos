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

export const CMS_INTERNAL_URL = `http://${CMS.app}.${CMS.namespace}.svc.cluster.local:${CMS.port}`;
export const WEBSITE_REVALIDATE_PATH = "/api/cms/revalidate";
export const CMS_HEALTH_PATH = "/healthz";
export const CMS_PUBLIC_MEDIA_PATH = "/api/media/file/";
export const CMS_OIDC_SECRET = "cms-oidc"; // pragma: allowlist secret (a Secret's name)
export const CMS_GATEWAY_CREDENTIAL_SECRET = "cms-platform-mcp"; // pragma: allowlist secret (a Secret's name)
export const CMS_GATEWAY_CREDENTIAL_KEY = "authorization"; // pragma: allowlist secret (a Secret key's name)
const PG_CA_PATH = "/etc/cms-pg-ca/ca.crt";

const byName = (name: string) => ({ podSelector: { matchLabels: { "app.kubernetes.io/name": name } } });
const inNamespace = (ns: pulumi.Input<string>) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ns } },
});

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
    CMS_EDGE_OIDC_ISSUER: cfg.observability.oidcIssuer,
    WEBSITE_REVALIDATE_URL: `http://web.${appNamespace}.svc.cluster.local:${PORT.web}${WEBSITE_REVALIDATE_PATH}`,
    WEBSITE_PUBLIC_URL: `https://${cfg.ingress.webDomain}`,
  };
}

export function cmsDatabaseUrl(password: pulumi.Input<string>): pulumi.Output<string> {
  return pulumi.interpolate`postgresql://${CMS.owner}:${pulumi.output(password).apply(encodeURIComponent)}@${CMS_PG_HOST}:${PORT.postgres}/${CMS.database}?sslmode=verify-full&sslrootcert=${PG_CA_PATH}`;
}

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
  dependsOn: pulumi.Resource[],
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
        minReadySeconds: 10,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            imagePullSecrets,
            automountServiceAccountToken: false,
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
                  { name: "next-cache", mountPath: "/app/.next/cache" },
                  { name: "tmp", mountPath: "/tmp" },
                ],
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
