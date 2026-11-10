import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { appPullPolicy, backendImage } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import { UID } from "../constants";
import { API_TIERS, CHAT_TIERS } from "./tier-names";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/**
 * The sandboxed fetcher of public sources (ADR-0158): RIS today, Fedlex and
 * every later legal or geodata source configured under `configs/sources/`.
 * `python -m public_sources.fetcher` on the backend image.
 *
 * The backend roles ask it to make a GET on a source's host; it makes it, and
 * nothing else. It holds no secret, no service-account token and no tenant
 * data, and the NetworkPolicy below is the layer that holds while code is
 * wrong: in, only the backend roles that run tools; out, DNS and public
 * addresses on 443. On Cilium a CIDR rule matches only destinations outside
 * the cluster, so no pod, Service or node of the cluster is reachable from it
 * whatever a source's DNS answers, and the private ranges are excepted for the
 * nodes' own network and the provider's metadata address. The fetcher checks
 * the source's host list and the resolved address again in process
 * (`public_sources/egress.py`).
 */
export const PUBLIC_SOURCE_FETCHER = {
  /** Deployment/Service name and `app.kubernetes.io/name`. */
  name: "public-source-fetcher",
  port: 8095,
  /** The roles whose tools fetch public sources: the chat turn, the api routes (the RIS reader, norm admin), research jobs. */
  callers: [...CHAT_TIERS, ...API_TIERS, "agent-worker"] as const,
  /** Never routed to: the cluster's and the node network's own ranges, link-local metadata, CGNAT, benchmarking, multicast, reserved. */
  privateV4: [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
  ],
  /** ULA, link-local, loopback, NAT64 (a gateway to IPv4, private ranges included) and IPv4-mapped. */
  privateV6: ["fc00::/7", "fe80::/10", "::1/128", "64:ff9b::/96", "::ffff:0:0/96"],
  resources: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
} as const;

/** `PUBLIC_SOURCE_FETCHER_URL` for the backend roles, exactly when the fetcher is deployed. */
export function publicSourceFetcherEnv(cfg: Pick<DeployConfig, "publicSourceFetcher">): EnvVar[] {
  if (!cfg.publicSourceFetcher.enabled) return [];
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  return [{ name: "PUBLIC_SOURCE_FETCHER_URL", value: `http://${name}:${port}` }];
}

export interface PublicSourceFetcher {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  /** Undefined when the stack runs without NetworkPolicies (`networkPolicies: false`). */
  networkPolicy?: k8s.networking.v1.NetworkPolicy;
}

export function installPublicSourceFetcher(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): PublicSourceFetcher {
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  const labels = commonLabels(name);
  const image = backendImage(cfg);

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        replicas: cfg.publicSourceFetcher.replicas,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            automountServiceAccountToken: false,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            containers: [
              {
                name,
                image,
                imagePullPolicy: appPullPolicy(cfg, image),
                securityContext: hardenedContainerSecurityContext(),
                // The image's working directory is /app, where configs/sources lives.
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

  return { deployment, service, networkPolicy };
}
