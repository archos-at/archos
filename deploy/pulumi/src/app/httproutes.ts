import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import type { IBackendTrafficPolicySpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/BackendTrafficPolicySpec";
import type { IHTTPRouteFilterSpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/HTTPRouteFilterSpec";
import { DeployConfig } from '../config'
import { commonLabels } from "../platform/namespaces";
import type { ICompression } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/Compression";
import type { IRetry } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/Retry";
import type { IRateLimitRule } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/RateLimitRule";
import type { IRateLimitSpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/RateLimitSpec";
import { GATEWAY_NAME } from "../platform/gateway";
import { EDGE_RATE_LIMIT, EDGE_RETRY, EDGE_TIMEOUT, PORT } from "../constants";
import { SIGNED_INTERNAL_ROUTE } from "../signed-route-constants";
import { logicalName, objectName } from "../names";
import { formerDomainRedirects, formerDomainRouteSpec } from "./former-domain";

export const edgeRetry: IRetry = {
  numRetries: EDGE_RETRY.numRetries,
  retryOn: { triggers: ["connect-failure", "refused-stream", "reset-before-request"] },
  perRetry: {
    backOff: { baseInterval: EDGE_RETRY.baseInterval, maxInterval: EDGE_RETRY.maxInterval },
  },
};

export const WEB_COMPRESSOR: ICompression[] = [{ type: "Brotli" }, { type: "Gzip" }];

function perClientIpRule(
  cfg: DeployConfig,
  requestsPerMinute: number,
  cidr: string,
  pathPrefix?: string,
): IRateLimitRule {
  return {
    clientSelectors: [
      {
        sourceCIDR: { value: cidr, type: "Distinct" },
        ...(pathPrefix ? { path: { type: "PathPrefix", value: pathPrefix } } : {}),
      },
    ],
    limit: { requests: requestsPerMinute, unit: "Minute" },
    shadowMode: cfg.rateLimit.shadowMode,
  };
}

export function edgeRateLimit(cfg: DeployConfig, rules: IRateLimitRule[]): { rateLimit?: IRateLimitSpec } {
  if (!cfg.rateLimit.enabled) return {};
  return { rateLimit: { type: "Global", global: { rules } } };
}

export function perClientRules(
  cfg: DeployConfig,
  requestsPerMinute: number,
  pathPrefix?: string,
): IRateLimitRule[] {
  return [
    perClientIpRule(cfg, requestsPerMinute, "0.0.0.0/0", pathPrefix),
    perClientIpRule(cfg, requestsPerMinute, "::/0", pathPrefix),
  ];
}

export function decimalAtMost(max: number): string {
  if (!Number.isSafeInteger(max) || max < 0) throw new Error(`decimalAtMost: ${max} is not a non-negative integer`);
  const digits = String(max);
  const alternatives = ["0"];
  if (digits.length > 1) alternatives.push(`[1-9][0-9]{0,${digits.length - 2}}`);
  for (let i = 0; i < digits.length; i++) {
    const low = i === 0 ? 1 : 0;
    const high = Number(digits[i]) - 1;
    if (high < low) continue;
    const rest = digits.length - i - 1;
    alternatives.push(`${digits.slice(0, i)}[${low}-${high}]${rest > 0 ? `[0-9]{${rest}}` : ""}`);
  }
  if (max > 0) alternatives.push(digits);
  return `^(?:${alternatives.join("|")})$`;
}

function installSignedInternalRoute(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource {
  const { routeName, pathPrefix, maxBodyBytes, requestTimeout, refusalFilterName } = SIGNED_INTERNAL_ROUTE;
  const refusalSpec: IHTTPRouteFilterSpec = {
    directResponse: {
      statusCode: 413,
      contentType: "text/plain",
      body: {
        type: "Inline",
        inline: `A signed internal route takes a fixed-length body of at most ${maxBodyBytes} bytes.\n`,
      },
    },
  };
  const refusal = new k8s.apiextensions.CustomResource(
    "signed-body-limit-filter",
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "HTTPRouteFilter",
      metadata: { name: refusalFilterName, namespace, labels: commonLabels("frontend") },
      spec: refusalSpec,
    },
    { provider, dependsOn },
  );

  const path = { type: "PathPrefix" as const, value: pathPrefix };
  const routeSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: "https-app" }],
    hostnames: [cfg.ingress.appDomain],
    rules: [
      {
        matches: [
          {
            path,
            headers: [{ type: "RegularExpression", name: "content-length", value: decimalAtMost(maxBodyBytes) }],
          },
        ],
        backendRefs: [{ name: "frontend", port: PORT.frontend }],
      },
      {
        matches: [{ path }],
        filters: [
          {
            type: "ExtensionRef",
            extensionRef: { group: "gateway.envoyproxy.io", kind: "HTTPRouteFilter", name: refusalFilterName },
          },
        ],
      },
    ],
  };
  const route = new k8s.apiextensions.CustomResource(
    "app-signed-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: routeName, namespace, labels: commonLabels("frontend") },
      spec: routeSpec,
    },
    { provider, dependsOn: [...dependsOn, refusal] },
  );

  const policySpec: IBackendTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: routeName }],
    timeout: { http: { requestTimeout } },
    retry: edgeRetry,
  };
  new k8s.apiextensions.CustomResource(
    "app-signed-backend-traffic-policy",
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "BackendTrafficPolicy",
      metadata: { name: `${routeName}-timeouts`, namespace, labels: commonLabels("frontend") },
      spec: policySpec,
    },
    { provider, dependsOn: route },
  );
  return route;
}

export function installHttpRoutes(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): {
  app: k8s.apiextensions.CustomResource;
  signed: k8s.apiextensions.CustomResource;
  s3: k8s.apiextensions.CustomResource;
  web: k8s.apiextensions.CustomResource;
  httpsRedirect: k8s.apiextensions.CustomResource;
} {
  const appRouteSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: "https-app" }],
    hostnames: [cfg.ingress.appDomain],
    rules: [{ backendRefs: [{ name: "frontend", port: PORT.frontend }] }],
  };
  const app = new k8s.apiextensions.CustomResource(
    logicalName("grid-app-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: objectName("appRoute"), namespace, labels: commonLabels("frontend") },
      spec: appRouteSpec,
    },
    { provider, dependsOn },
  );
  const signed = installSignedInternalRoute(cfg, provider, namespace, dependsOn);

  const appBackendPolicySpec: IBackendTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: objectName("appRoute") }],
    timeout: { http: { requestTimeout: EDGE_TIMEOUT } },
    retry: edgeRetry,
    ...edgeRateLimit(cfg, [
      ...perClientRules(cfg, cfg.rateLimit.limits.appAuth, EDGE_RATE_LIMIT.paths.auth),
      ...perClientRules(cfg, cfg.rateLimit.limits.appWsUpgrade, EDGE_RATE_LIMIT.paths.ws),
      ...perClientRules(cfg, cfg.rateLimit.limits.app),
    ]),
  };
  new k8s.apiextensions.CustomResource(
    logicalName("grid-app-backend-traffic-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "BackendTrafficPolicy",
      metadata: { name: objectName("appTimeouts"), namespace, labels: commonLabels("frontend") },
      spec: appBackendPolicySpec,
    },
    { provider, dependsOn: app },
  );

  const s3BackendPolicySpec: IBackendTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: objectName("s3Route") }],
    timeout: { http: { requestTimeout: EDGE_TIMEOUT } },
    retry: edgeRetry,
    ...edgeRateLimit(cfg, perClientRules(cfg, cfg.rateLimit.limits.s3)),
  };

  const s3RouteSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: "https-s3" }],
    hostnames: [cfg.ingress.s3Domain],
    rules: [{ backendRefs: [{ name: "seaweedfs", port: PORT.seaweedS3 }] }],
  };
  const s3 = new k8s.apiextensions.CustomResource(
    logicalName("grid-s3-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: objectName("s3Route"), namespace, labels: commonLabels("seaweedfs") },
      spec: s3RouteSpec,
    },
    { provider, dependsOn },
  );

  const webRouteSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: "https-web" }],
    hostnames: [cfg.ingress.webDomain],
    rules: [{ backendRefs: [{ name: "web", port: PORT.web }] }],
  };
  const web = new k8s.apiextensions.CustomResource(
    logicalName("grid-web-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: objectName("webRoute"), namespace, labels: commonLabels("web") },
      spec: webRouteSpec,
    },
    { provider, dependsOn },
  );

  new k8s.apiextensions.CustomResource(
    logicalName("grid-s3-backend-traffic-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "BackendTrafficPolicy",
      metadata: { name: objectName("s3Timeouts"), namespace, labels: commonLabels("seaweedfs") },
      spec: s3BackendPolicySpec,
    },
    { provider, dependsOn: s3 },
  );

  const webBackendPolicySpec: IBackendTrafficPolicySpec = {
    targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: objectName("webRoute") }],
    retry: edgeRetry,
    compressor: WEB_COMPRESSOR,
    ...edgeRateLimit(cfg, perClientRules(cfg, cfg.rateLimit.limits.web)),
  };
  new k8s.apiextensions.CustomResource(
    logicalName("grid-web-backend-traffic-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "BackendTrafficPolicy",
      metadata: { name: objectName("webTimeouts"), namespace, labels: commonLabels("web") },
      spec: webBackendPolicySpec,
    },
    { provider, dependsOn: web },
  );

  const httpsRedirectSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: "http" }],
    rules: [{ filters: [{ type: "RequestRedirect", requestRedirect: { scheme: "https", statusCode: 301 } }] }],
  };
  const httpsRedirect = new k8s.apiextensions.CustomResource(
    logicalName("grid-https-redirect-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: objectName("httpsRedirectRoute"), namespace, labels: commonLabels("gateway") },
      spec: httpsRedirectSpec,
    },
    { provider, dependsOn },
  );

  for (const redirect of formerDomainRedirects(cfg.ingress)) {
    if (redirect.serves.length > 0) {
      new k8s.apiextensions.CustomResource(
        logicalName(`${redirect.route}-traffic-policy`),
        {
          apiVersion: "gateway.envoyproxy.io/v1alpha1",
          kind: "BackendTrafficPolicy",
          metadata: { name: objectName("formerAppTimeouts"), namespace, labels: commonLabels("frontend") },
          spec: {
            targetRefs: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: redirect.route }],
            timeout: { http: { requestTimeout: EDGE_TIMEOUT } },
            retry: edgeRetry,
            ...edgeRateLimit(cfg, perClientRules(cfg, cfg.rateLimit.limits.app)),
          } satisfies IBackendTrafficPolicySpec,
        },
        { provider, dependsOn },
      );
    }
    new k8s.apiextensions.CustomResource(
      logicalName(`grid-${redirect.route.replace(/^grid-/, "")}-route`),
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "HTTPRoute",
        metadata: { name: redirect.route, namespace, labels: commonLabels("gateway") },
        spec: formerDomainRouteSpec(redirect, GATEWAY_NAME),
      },
      { provider, dependsOn },
    );
  }

  return { app, signed, s3, web, httpsRedirect };
}
