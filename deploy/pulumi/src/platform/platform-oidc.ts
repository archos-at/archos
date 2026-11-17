import type { ISecurityPolicySpec } from "@kubernetes-models/envoy-gateway/gateway.envoyproxy.io/v1alpha1/SecurityPolicySpec";
import { DeployConfig } from '../config'

export const PLATFORM_VIEW_PERMISSION = "platform:organizations:view";

export const OBSERVABILITY_VIEW_PERMISSION = "platform:observability:view";

export const OIDC_CLIENT_SECRET_KEY = "client-secret"; // pragma: allowlist secret (Secret key name fixed by the Envoy Gateway API, not a credential)

export interface PlatformOidcGate {
  routeName: string;
  domain: string;
  secretName: string;
  alsoAdmit?: readonly string[];
}

export function platformOidcSecurityPolicySpec(
  cfg: DeployConfig,
  gate: PlatformOidcGate,
): ISecurityPolicySpec {
  const issuer = cfg.observability.oidcIssuer;
  const jwtProviderName = "workos";
  const admitted = [PLATFORM_VIEW_PERMISSION, ...(gate.alsoAdmit ?? [])].filter(
    (permission, index, all) => all.indexOf(permission) === index,
  );

  return {
    targetRefs: [
      { group: "gateway.networking.k8s.io", kind: "HTTPRoute", name: gate.routeName },
    ],
    oidc: {
      provider: {
        issuer,
        authorizationEndpoint: `${issuer}/oauth2/authorize`,
        tokenEndpoint: `${issuer}/oauth2/token`,
      },
      clientID: cfg.observability.oidcClientId,
      clientSecret: { name: gate.secretName },
      scopes: ["openid", "profile", "email", "offline_access", ...admitted],
      redirectURL: `https://${gate.domain}/oauth2/callback`,
      logoutPath: "/logout",
      forwardAccessToken: true,
      defaultTokenTTL: "5m",
      refreshToken: true,
    },
    jwt: {
      providers: [
        {
          name: jwtProviderName,
          issuer,
          remoteJWKS: { uri: `${issuer}/oauth2/jwks` },
        },
      ],
    },
    authorization: {
      defaultAction: "Deny",
      rules: admitted.map((permission) => ({
        name: permission === PLATFORM_VIEW_PERMISSION ? "platform-permission-only" : ruleName(permission),
        action: "Allow" as const,
        principal: {
          jwt: { provider: jwtProviderName, scopes: [permission] },
        },
      })),
    },
  };
}

function ruleName(permission: string): string {
  return `${permission.split(":").slice(1).join("-")}-permission`;
}
