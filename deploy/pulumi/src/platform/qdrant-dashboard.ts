import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { IHTTPRouteSpec } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1/HTTPRouteSpec";
import { DeployConfig } from '../config'
import { EDGE_TIMEOUT, PORT, QDRANT } from "../constants";
import { GATEWAY_NAME } from "./gateway";
import { commonLabels } from "./namespaces";
import { OIDC_CLIENT_SECRET_KEY, platformOidcSecurityPolicySpec } from "./platform-oidc";
import { logicalName } from "../names";

const STRIPPED_REQUEST_HEADERS = ["Authorization", "Cookie"] as const;

export function installQdrantDashboard(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): void {
  const dashboard = cfg.qdrant.dashboard;
  const labels = commonLabels(QDRANT.name);

  const oidcSecret = new k8s.core.v1.Secret(
    QDRANT.dashboard.oidcSecret,
    {
      metadata: { name: QDRANT.dashboard.oidcSecret, namespace, labels },
      stringData: { [OIDC_CLIENT_SECRET_KEY]: cfg.observability.oidcClientSecret },
    },
    { provider },
  );

  const routeSpec: IHTTPRouteSpec = {
    parentRefs: [{ name: GATEWAY_NAME, sectionName: QDRANT.dashboard.listenerName }],
    hostnames: [dashboard.domain],
    rules: [
      {
        matches: [{ path: { type: "Exact", value: "/" } }],
        filters: [
          {
            type: "RequestRedirect",
            requestRedirect: {
              path: { type: "ReplaceFullPath", replaceFullPath: QDRANT.dashboard.path },
              statusCode: 302,
            },
          },
        ],
      },
      {
        backendRefs: [{ name: QDRANT.name, port: PORT.qdrantHttp }],
        filters: [
          {
            type: "RequestHeaderModifier",
            requestHeaderModifier: { remove: [...STRIPPED_REQUEST_HEADERS] },
          },
        ],
        timeouts: { request: EDGE_TIMEOUT, backendRequest: EDGE_TIMEOUT },
      },
    ],
  };
  const securityPolicy = new k8s.apiextensions.CustomResource(
    logicalName("grid-qdrant-dashboard-security-policy"),
    {
      apiVersion: "gateway.envoyproxy.io/v1alpha1",
      kind: "SecurityPolicy",
      metadata: { name: QDRANT.dashboard.policyName, namespace, labels },
      spec: platformOidcSecurityPolicySpec(cfg, {
        routeName: QDRANT.dashboard.routeName,
        domain: dashboard.domain,
        secretName: QDRANT.dashboard.oidcSecret,
      }),
    },
    { provider, dependsOn: [oidcSecret] },
  );

  new k8s.apiextensions.CustomResource(
    logicalName("grid-qdrant-dashboard-route"),
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: QDRANT.dashboard.routeName, namespace, labels },
      spec: routeSpec,
    },
    { provider, dependsOn: [...dependsOn, securityPolicy] },
  );
}
