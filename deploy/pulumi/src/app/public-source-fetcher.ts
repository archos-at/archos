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

/**
 * The sandboxed fetcher of public sources (ADR-0162): RIS today, Fedlex and
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
  /**
   * ULA, link-local, loopback and NAT64 (a gateway to IPv4, private ranges included). Not IPv4-mapped
   * (`::ffff:0:0/96`): the API server parses it as IPv4 and refuses it as no subset of `::/0`, which failed
   * every dev deploy after #1592. A mapped address leaves as IPv4, where `privateV4` holds it, and the
   * fetcher's own guard refuses one before connecting (`test_egress.py`, `v4_mapped_private`).
   */
  privateV6: ["fc00::/7", "fe80::/10", "::1/128", "64:ff9b::/96"],
  /**
   * It also parses the PDFs it fetches (`POST /v1/extract`): at most two readers at once, each a child process
   * held to 1 GiB of address space (`public_sources/pdf.py`), beside the server itself (about 65 MiB idle,
   * measured 2026-11-10). The request holds the server and one large reader, so under node pressure it is not
   * the first pod evicted; the limit holds both readers at their ceiling.
   */
  resources: {
    requests: { cpu: "100m", memory: "1Gi" },
    limits: { cpu: "1000m", memory: "2560Mi" },
  },
} as const;

/**
 * Its rollout: a source fetch or a PDF parse, the longest of which a caller
 * waits 50 s for (`EXTRACT_TIMEOUT_SECONDS` in `public_sources/pdf.py`, which
 * `test_pdf_in_fetcher.py` holds this against). Surge-only, so a source is
 * never unreachable mid-deploy; the preStop sleep keeps the old pod serving
 * while the Service stops routing to it, then uvicorn finishes the requests it
 * holds. Grace = hook + 50 s + slack.
 */
export const FETCHER_ROLLOUT: RolloutProfile = {
  minReadySeconds: 10,
  progressDeadlineSeconds: 600,
  terminationGracePeriodSeconds: 65,
  endpointDrainSeconds: 5,
};

/** `PUBLIC_SOURCE_FETCHER_URL` for the backend roles: the one way they reach a public source. */
export function publicSourceFetcherEnv(): EnvVar[] {
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  return [{ name: "PUBLIC_SOURCE_FETCHER_URL", value: `http://${name}:${port}` }];
}

export interface PublicSourceFetcher {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  /** Undefined when the stack runs without NetworkPolicies (`networkPolicies: false`). */
  networkPolicy?: k8s.networking.v1.NetworkPolicy;
  /**
   * At most one pod away in a voluntary disruption. With one replica (the default) a node drain still
   * evicts it, and public sources and PDF captures are refused until it is scheduled again (the surge
   * rollout covers a deploy, not a drain); `replicas: 2` closes that gap.
   */
  pdb: k8s.policy.v1.PodDisruptionBudget;
}

export function installPublicSourceFetcher(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
  /**
   * The registry pull Secret, as every app pod has it: the fetcher runs the private backend image.
   * Required, not defaulted: without it the pod never pulls on a private registry (ImagePullBackOff,
   * every dev deploy after #1592 until #1603).
   */
  imagePullSecrets: { name: string }[],
): PublicSourceFetcher {
  const { name, port } = PUBLIC_SOURCE_FETCHER;
  const labels = commonLabels(name);
  const image = backendImage(cfg);
  // A rollout mid-parse must not cut it: preStop drain, then uvicorn finishes what it holds.
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
            // Beside the backend roles that call it.
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name,
                image,
                imagePullPolicy: appPullPolicy(cfg, image),
                securityContext: hardenedContainerSecurityContext(),
                lifecycle: shutdown.lifecycle,
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

  const pdb = installPdb(name, namespace, provider, labels, [deployment]);

  return { deployment, service, networkPolicy, pdb };
}
