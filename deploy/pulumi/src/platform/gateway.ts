import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IGatewaySpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/GatewaySpec";
import type { IGatewayClassSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/GatewayClassSpec";
import type { IEnvoyProxySpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/EnvoyProxySpec";
import type { IClientTrafficPolicySpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/ClientTrafficPolicySpec";
import { DeployConfig } from '../config'
import { commonLabels } from "./namespaces";
import { EDGE_SHUTDOWN, SURGE_ONLY_STRATEGY } from "./rollout";
import { EDGE_RATE_LIMIT, EDGE_TIMEOUT, LANGFUSE, PLATFORM_RESOURCES, QDRANT } from "../constants";
import { MCP_GATEWAY } from "./mcp-gateway-config";
import { logicalName, objectName } from "../names";
import { formerDomainListener, formerDomainRedirects, formerMcpGatewayHost } from "../app/former-domain";
import { CMS } from "../config/cms";
import { scaledCpuRequest } from "../config/cpu-requests";

export const GATEWAY_NAME = objectName("gateway");
export const GATEWAY_CLASS = objectName("gatewayClass");

export const ENVOY_GATEWAY_CHART_VERSION = "1.10.0";

export function installGatewayController(
  cfg: DeployConfig,
  provider: k8s.Provider,
): k8s.helm.v3.Release {
  const ns = new k8s.core.v1.Namespace(
    "envoy-gateway-ns",
    { metadata: { name: "envoy-gateway-system" } },
    { provider },
  );

  const redisAuthSecret =
    cfg.rateLimit.enabled && cfg.rateLimit.storePassword
      ? new k8s.core.v1.Secret(
          "ratelimit-redis-auth",
          {
            metadata: { name: RATE_LIMIT_REDIS_AUTH_SECRET, namespace: ns.metadata.name },
            stringData: { [RATE_LIMIT_REDIS_AUTH_KEY]: cfg.rateLimit.storePassword },
          },
          { provider, dependsOn: ns },
        )
      : undefined;

  return new k8s.helm.v3.Release(
    "envoy-gateway",
    {
      chart: "oci://docker.io/envoyproxy/gateway-helm",
      version: ENVOY_GATEWAY_CHART_VERSION,
      namespace: ns.metadata.name,
      values: cfg.rateLimit.enabled
        ? { config: { envoyGateway: rateLimitConfig(cfg, redisAuthSecret !== undefined) } }
        : {},
    },
    { provider, dependsOn: [ns, ...(redisAuthSecret ? [redisAuthSecret] : [])] },
  );
}

const RATE_LIMIT_REDIS_AUTH_SECRET = objectName("rateLimitRedisAuthSecret"); // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
const RATE_LIMIT_REDIS_AUTH_KEY = "REDIS_AUTH"; // pragma: allowlist secret (env var name, not a credential)

function rateLimitConfig(cfg: DeployConfig, withRedisAuth: boolean): Record<string, unknown> {
  return {
    rateLimit: {
      backend: {
        type: "Redis",
        redis: { url: `${EDGE_RATE_LIMIT.storeService}.${cfg.namespace}.svc.cluster.local:6379` },
      },
      failClosed: cfg.rateLimit.failClosed,
      timeout: EDGE_RATE_LIMIT.timeout,
    },
    ...(withRedisAuth
      ? {
          provider: {
            type: "Kubernetes",
            kubernetes: {
              rateLimitDeployment: {
                container: {
                  env: [
                    {
                      name: RATE_LIMIT_REDIS_AUTH_KEY,
                      valueFrom: {
                        secretKeyRef: {
                          name: RATE_LIMIT_REDIS_AUTH_SECRET,
                          key: RATE_LIMIT_REDIS_AUTH_KEY,
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        }
      : {}),
  };
}

export function installGatewayResources(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  issuerName: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): { gatewayClass: k8s.apiextensions.CustomResource; gateway: k8s.apiextensions.CustomResource } {
  const gatewayClassSpec: IGatewayClassSpec = {
    controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
  };
  const gatewayClass = new k8s.apiextensions.CustomResource(
    logicalName("grid-gatewayclass"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "GatewayClass",
      metadata: { name: GATEWAY_CLASS, labels: commonLabels("gateway") },
      spec: gatewayClassSpec,
    },
    { provider, dependsOn },
  );

  const envoyService = cfg.ingress.loadBalancerIp
    ? { annotations: { "k8s.at/managed-loadbalancer-ip": cfg.ingress.loadBalancerIp } }
    : undefined;
  const envoyProxySpec: IEnvoyProxySpec = {
    provider: {
      type: "Kubernetes",
      kubernetes: {
        ...(envoyService ? { envoyService } : {}),
        envoyDeployment: {
          replicas: 2,
          strategy: SURGE_ONLY_STRATEGY,
          container: { resources: scaledCpuRequest(PLATFORM_RESOURCES.envoyProxy) },
          pod: {
            affinity: {
              podAntiAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                  {
                    weight: 100,
                    podAffinityTerm: {
                      topologyKey: "kubernetes.io/hostname",
                      labelSelector: {
                        matchLabels: { "gateway.envoyproxy.io/owning-gateway-name": GATEWAY_NAME },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        envoyPDB: { maxUnavailable: 1 },
      },
    },
    shutdown: EDGE_SHUTDOWN,
  };
  const envoyProxyConfig = new k8s.apiextensions.CustomResource(
    logicalName("grid-envoy-proxy-config"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "EnvoyProxy",
      metadata: { name: objectName("envoyProxy"), namespace, labels: commonLabels("gateway") },
      spec: envoyProxySpec,
    },
    { provider, dependsOn },
  );

  const langfuseListeners: IGatewaySpec["listeners"] = cfg.langfuse.enabled
    ? [
        {
          name: LANGFUSE.listenerName,
          port: 443,
          protocol: "HTTPS",
          hostname: cfg.langfuse.domain,
          tls: { mode: "Terminate", certificateRefs: [{ name: objectName("langfuseTls") }] },
          allowedRoutes: { namespaces: { from: "Same" } },
        },
      ]
    : [];

  const qdrantListeners: IGatewaySpec["listeners"] = cfg.qdrant.dashboard.enabled
    ? [
        {
          name: QDRANT.dashboard.listenerName,
          port: 443,
          protocol: "HTTPS",
          hostname: cfg.qdrant.dashboard.domain,
          tls: { mode: "Terminate", certificateRefs: [{ name: QDRANT.dashboard.tlsSecret }] },
          allowedRoutes: { namespaces: { from: "Same" } },
        },
      ]
    : [];

  const cmsListeners: IGatewaySpec["listeners"] = cfg.cms.enabled
    ? [
        {
          name: CMS.listenerName,
          port: 443,
          protocol: "HTTPS",
          hostname: cfg.cms.domain,
          tls: { mode: "Terminate", certificateRefs: [{ name: CMS.tlsSecret }] },
          allowedRoutes: {
            namespaces: { from: "Selector", selector: { matchLabels: { "kubernetes.io/metadata.name": CMS.namespace } } },
          },
        },
      ]
    : [];

  const mcpGatewayListeners: IGatewaySpec["listeners"] = cfg.mcpGateway.enabled
    ? [
        {
          name: MCP_GATEWAY.listenerName,
          port: 443,
          protocol: "HTTPS",
          hostname: cfg.mcpGateway.domain,
          tls: { mode: "Terminate", certificateRefs: [{ name: MCP_GATEWAY.tlsSecret }] },
          allowedRoutes: { namespaces: { from: "Same" } },
        },
      ]
    : [];

  const gatewaySpec: IGatewaySpec = {
    gatewayClassName: GATEWAY_CLASS,
    infrastructure: {
      parametersRef: { group: "gateway.envoyproxy.io", kind: "EnvoyProxy", name: objectName("envoyProxy") },
    },
    listeners: [
      {
        name: "http",
        port: 80,
        protocol: "HTTP",
        allowedRoutes: { namespaces: { from: "Same" } },
      },
      {
        name: "https-app",
        port: 443,
        protocol: "HTTPS",
        hostname: cfg.ingress.appDomain,
        tls: { mode: "Terminate", certificateRefs: [{ name: objectName("appTls") }] },
        allowedRoutes: { namespaces: { from: "Same" } },
      },
      {
        name: "https-s3",
        port: 443,
        protocol: "HTTPS",
        hostname: cfg.ingress.s3Domain,
        tls: { mode: "Terminate", certificateRefs: [{ name: objectName("s3Tls") }] },
        allowedRoutes: { namespaces: { from: "Same" } },
      },
      {
        name: "https-web",
        port: 443,
        protocol: "HTTPS",
        hostname: cfg.ingress.webDomain,
        tls: { mode: "Terminate", certificateRefs: [{ name: objectName("webTls") }] },
        allowedRoutes: { namespaces: { from: "Same" } },
      },
      ...langfuseListeners,
      ...qdrantListeners,
      ...cmsListeners,
      ...mcpGatewayListeners,
      ...formerDomainRedirects(cfg.ingress).map(formerDomainListener),
      ...[formerMcpGatewayHost(cfg.ingress, cfg.mcpGateway)].filter((h) => h !== undefined).map(formerDomainListener),
    ],
  };
  const gateway = new k8s.apiextensions.CustomResource(
    logicalName("grid-gateway"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: {
        name: GATEWAY_NAME,
        namespace,
        labels: commonLabels("gateway"),
        annotations: { "cert-manager.io/cluster-issuer": issuerName } as { [k: string]: pulumi.Input<string> },
      },
      spec: gatewaySpec,
    },
    { provider, dependsOn: [gatewayClass, envoyProxyConfig] },
  );

  const clientTrafficPolicySpec: IClientTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "Gateway", name: GATEWAY_NAME }],
    timeout: { http: { idleTimeout: EDGE_TIMEOUT, streamIdleTimeout: EDGE_TIMEOUT } },
    clientIPDetection: { xForwardedFor: { numTrustedHops: cfg.ingress.xffNumTrustedHops } },
    ...(cfg.ingress.maxConnectionsPerProxy > 0
      ? {
          connection: {
            connectionLimit: {
              value: cfg.ingress.maxConnectionsPerProxy,
              closeDelay: "1s",
            },
          },
        }
      : {}),
  };
  new k8s.apiextensions.CustomResource(
    logicalName("grid-client-traffic-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "ClientTrafficPolicy",
      metadata: { name: objectName("wsTimeouts"), namespace, labels: commonLabels("gateway") },
      spec: clientTrafficPolicySpec,
    },
    { provider, dependsOn: gateway },
  );

  return { gatewayClass, gateway };
}
