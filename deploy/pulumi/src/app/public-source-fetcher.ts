import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { appPullPolicy, backendImage } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { type RolloutProfile, gracefulShutdown, surgeRollout } from "../platform/rollout";
import { installPdb, onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { UID } from "../constants";
import { API_TIERS, CHAT_TIERS } from "./tier-names";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export const PUBLIC_SOURCE_FETCHER = {
  name: "public-source-fetcher",
  port: 8095,
  callers: [...CHAT_TIERS, ...API_TIERS, "agent-worker"] as const,
  privateV4: [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
  ],
  privateV6: ["fc00::/7", "fe80::/10", "::1/128", "64:ff9b::/96"],
  resources: {
    // The server idles at about 65 MiB (measured 2026-11-10); two PDF readers at 1 GiB each fit the limit.
    requests: { cpu: "100m", memory: "1Gi" },
    limits: { cpu: "1000m", memory: "2560Mi" },
  },
} as const;

export const FETCHER_ROLLOUT: RolloutProfile = {
  minReadySeconds: 10,
  progressDeadlineSeconds: 600,
  terminationGracePeriodSeconds: 65,
  endpointDrainSeconds: 5,
};

export function publicSourceFetcherEnv(): EnvVar[] {
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  return [{ name: "PUBLIC_SOURCE_FETCHER_URL", value: `http://${name}:${port}` }];
}

export interface PublicSourceFetcher {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  networkPolicy?: k8s.networking.v1.NetworkPolicy;
  pdb: k8s.policy.v1.PodDisruptionBudget;
}

export function installPublicSourceFetcher(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  imagePullSecrets: { name: string }[],
): PublicSourceFetcher {
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  const labels = commonLabels(name);
  const image = backendImage(cfg);
  const shutdown = gracefulShutdown(FETCHER_ROLLOUT, "python");

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        replicas: cfg.publicSourceFetcher.replicas,
        selector: { matchLabels: labels },
        ...surgeRollout(FETCHER_ROLLOUT),
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            automountServiceAccountToken: false,
            imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name,
                image,
                imagePullPolicy: appPullPolicy(cfg, image),
                securityContext: hardenedContainerSecurityContext(),
                lifecycle: shutdown.lifecycle,
                command: ["/app/.venv/bin/python", "-m", "public_sources.fetcher"],
                env: [
                  { name: "PORT", value: String(port) },
                  { name: "PUBLIC_SOURCES_DIR", value: "/app/configs/sources" },
                ],
                ports: [{ containerPort: port, name: "http" }],
                resources: PUBLIC_SOURCE_FETCHER.resources,
                readinessProbe: { httpGet: { path: "/healthz", port }, periodSeconds: 10 },
                livenessProbe: { httpGet: { path: "/healthz", port }, initialDelaySeconds: 10, periodSeconds: 20 },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace, labels },
      spec: { selector: labels, ports: [{ port, targetPort: port, name: "http" }] },
    },
    { provider, dependsOn: deployment },
  );

  const networkPolicy = cfg.networkPolicies
    ? new k8s.networking.v1.NetworkPolicy(
        `${name}-sandbox`,
        {
          metadata: { name: `${name}-sandbox`, namespace },
          spec: {
            podSelector: { matchLabels: { "app.kubernetes.io/name": name } },
            policyTypes: ["Ingress", "Egress"],
            ingress: [
              {
                from: PUBLIC_SOURCE_FETCHER.callers.map((caller) => ({
                  podSelector: { matchLabels: { "app.kubernetes.io/name": caller } },
                })),
                ports: [{ protocol: "TCP", port }],
              },
            ],
            egress: [
              {
                to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
                ports: [
                  { protocol: "UDP", port: 53 },
                  { protocol: "TCP", port: 53 },
                ],
              },
              {
                to: [
                  { ipBlock: { cidr: "0.0.0.0/0", except: [...PUBLIC_SOURCE_FETCHER.privateV4] } },
                  { ipBlock: { cidr: "::/0", except: [...PUBLIC_SOURCE_FETCHER.privateV6] } },
                ],
                ports: [{ protocol: "TCP", port: 443 }],
              },
            ],
          },
        },
        { provider },
      )
    : undefined;

  const pdb = installPdb(name, namespace, provider, labels, [deployment]);

  return { deployment, service, networkPolicy, pdb };
}
