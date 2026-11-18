import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { GATEWAY_NAME } from "./gateway";
import { PLATFORM_RESOURCES } from "../constants";

export const CERT_MANAGER_CHART_VERSION = "v1.21.3";

export interface CertManager {
  release: k8s.helm.v3.Release;
  issuer: k8s.apiextensions.CustomResource;
  issuerName: pulumi.Output<string>;
}

export function installCertManager(
  cfg: DeployConfig,
  provider: k8s.Provider,
  gatewayNamespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): CertManager {
  const ns = new k8s.core.v1.Namespace(
    "cert-manager-ns",
    { metadata: { name: "cert-manager" } },
    { provider },
  );

  const release = new k8s.helm.v3.Release(
    "cert-manager",
    {
      chart: "cert-manager",
      version: CERT_MANAGER_CHART_VERSION,
      namespace: ns.metadata.name,
      repositoryOpts: { repo: "https://charts.jetstack.io" },
      values: {
        crds: { enabled: true },
        config: {
          apiVersion: "controller.config.cert-manager.io/v1alpha1",
          kind: "ControllerConfiguration",
          enableGatewayAPI: true,
        },
        resources: PLATFORM_RESOURCES.certManager,
      },
    },
    { provider, dependsOn: [ns, ...dependsOn] },
  );

  const issuerName = cfg.ingress.useStagingIssuer ? "letsencrypt-staging" : "letsencrypt-prod";
  const acmeServer = cfg.ingress.useStagingIssuer
    ? "https://acme-staging-v02.api.letsencrypt.org/directory"
    : "https://acme-v02.api.letsencrypt.org/directory";

  const issuer = new k8s.apiextensions.CustomResource(
    "letsencrypt-issuer",
    {
      apiVersion: "cert-manager.io/v1",
      kind: "ClusterIssuer",
      metadata: { name: issuerName },
      spec: {
        acme: {
          server: acmeServer,
          email: cfg.ingress.letsEncryptEmail,
          privateKeySecretRef: { name: `${issuerName}-account-key` },
          solvers: [
            {
              http01: {
                gatewayHTTPRoute: {
                  parentRefs: [
                    {
                      name: GATEWAY_NAME,
                      namespace: gatewayNamespace,
                      kind: "Gateway",
                      group: "gateway.networking.k8s.io",
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
    { provider, dependsOn: release },
  );

  return { release, issuer, issuerName: pulumi.output(issuerName) };
}
