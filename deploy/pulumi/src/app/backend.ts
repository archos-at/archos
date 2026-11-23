import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { backendAutoscaled } from '../config/chat-tier'
import { appPullPolicy, backendImage } from '../config/images'
import { toResourceRequirements } from '../config/resources'
import { commonLabels } from "../platform/namespaces";
import { installPdb, onNodeGroup, spreadAcrossNodes } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import {
  backendRollout,
  gracefulShutdown,
  orderedRollout,
  secretChecksumAnnotations,
} from "../platform/rollout";
import { withLangfuseKeysChecksum } from "../platform/langfuse";
import { AppSecrets, AppWiring, chatEnv } from "./config";
import { PORT, UID } from "../constants";
import { CHAT_TIER, LEGACY_CHAT_TIER } from "./tier-names";

export interface Backend {
  statefulSet: k8s.apps.v1.StatefulSet;
  service: k8s.core.v1.Service;
  headlessService: k8s.core.v1.Service;
  pdb?: k8s.policy.v1.PodDisruptionBudget;
}

export function installBackend(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
  name: string = CHAT_TIER,
): Backend {
  const labels = commonLabels(name);
  const headlessName = `${name}-headless`;
  const autoscaled = backendAutoscaled(cfg);
  const multiReplica = cfg.backend.replicas > 1 || autoscaled;
  const profile = backendRollout(cfg.backend.drainSeconds);
  const shutdown = gracefulShutdown(profile, "python");

  const statefulSet = new k8s.apps.v1.StatefulSet(
    name,
    {
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        serviceName: headlessName,
        replicas: cfg.backend.replicas,
        selector: { matchLabels: labels },
        ...orderedRollout(profile),
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(withLangfuseKeysChecksum(cfg, secrets.checksum)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: UID.backend, runAsGroup: UID.backend },
            ...(multiReplica ? { topologySpreadConstraints: spreadAcrossNodes(labels) } : {}),
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name,
                image: backendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, backendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                ports: [{ containerPort: PORT.backend, name: "http" }],
                env: chatEnv(w),
                resources: toResourceRequirements(name === LEGACY_CHAT_TIER ? cfg.backend.legacyResources : cfg.backend.resources),
                lifecycle: shutdown.lifecycle,
                startupProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: 10,
                  failureThreshold: 60,
                },
                readinessProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: 15,
                  timeoutSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/health", port: PORT.backend },
                  periodSeconds: 20,
                  timeoutSeconds: 10,
                  failureThreshold: 6,
                },
              },
            ],
          },
        },
      },
    },
    {
      provider: w.provider,
      dependsOn: [secrets.secret, ...dependsOn],
      ignoreChanges: autoscaled ? ["spec.replicas"] : [],
      deleteBeforeReplace: true,
      customTimeouts: {
        create: "25m",
        update: `${Math.ceil(profile.terminationGracePeriodSeconds / 60) * cfg.backend.maxReplicas + 25}m`,
      },
    },
  );

  const headlessService = new k8s.core.v1.Service(
    headlessName,
    {
      metadata: { name: headlessName, namespace: w.namespace, labels },
      spec: {
        clusterIP: "None",
        selector: labels,
        ports: [{ port: PORT.backend, targetPort: PORT.backend, name: "http" }],
        publishNotReadyAddresses: true,
      },
    },
    { provider: w.provider },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace: w.namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.backend, targetPort: PORT.backend, name: "http" }],
      },
    },
    { provider: w.provider, dependsOn: statefulSet },
  );

  const pdb = multiReplica
    ? installPdb(name, w.namespace, w.provider, labels, [statefulSet])
    : undefined;

  return { statefulSet, service, headlessService, pdb };
}
