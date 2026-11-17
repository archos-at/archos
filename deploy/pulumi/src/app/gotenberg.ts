import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import { ROLLOUT, gracefulShutdown, surgeRollout } from "../platform/rollout";
import { GOTENBERG, PORT, UID } from "../constants";
import { scrapeAnnotations } from "../platform/scrape";

export interface Gotenberg {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  url: pulumi.Output<string>;
}

export function installGotenberg(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): Gotenberg {
  const labels = commonLabels(GOTENBERG.name);
  const shutdown = gracefulShutdown(ROLLOUT.converter, "coreutils");

  const deployment = new k8s.apps.v1.Deployment(
    GOTENBERG.name,
    {
      metadata: { name: GOTENBERG.name, namespace, labels },
      spec: {
        replicas: cfg.gotenberg.replicas,
        selector: { matchLabels: labels },
        ...surgeRollout(ROLLOUT.converter),
        template: {
          metadata: { labels, annotations: scrapeAnnotations(PORT.gotenberg, "/prometheus/metrics") },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: UID.gotenberg,
              runAsGroup: UID.gotenberg,
            },
            ...onNodeGroup(cfg.nodeGroups.batch),
            containers: [
              {
                name: GOTENBERG.name,
                image: cfg.gotenberg.image,
                imagePullPolicy: pullPolicyFor(cfg.gotenberg.image),
                securityContext: hardenedContainerSecurityContext(),
                lifecycle: shutdown.lifecycle,
                args: [...GOTENBERG.args],
                ports: [{ containerPort: PORT.gotenberg, name: "http" }],
                resources: GOTENBERG.resources,
                readinessProbe: {
                  httpGet: { path: "/health", port: PORT.gotenberg },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/health", port: PORT.gotenberg },
                  initialDelaySeconds: 30,
                  periodSeconds: 20,
                  failureThreshold: 5,
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn },
  );

  const service = new k8s.core.v1.Service(
    GOTENBERG.name,
    {
      metadata: { name: GOTENBERG.name, namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.gotenberg, targetPort: PORT.gotenberg, name: "http" }],
      },
    },
    { provider, dependsOn: deployment },
  );

  return {
    deployment,
    service,
    url: pulumi.output(`http://${GOTENBERG.name}:${PORT.gotenberg}`),
  };
}
