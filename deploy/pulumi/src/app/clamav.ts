import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeployConfig } from "../config";
import { pullPolicyFor } from "../config/images";
import { CLAMAV } from "../clamav-constants";
import { commonLabels } from "../platform/namespaces";
import { ROLLOUT, assertStartupFitsRollout, gracefulShutdown, secretChecksum, secretChecksumAnnotations, surgeRollout } from "../platform/rollout";
import { onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";

export interface ClamAV {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
  url: pulumi.Output<string>;
}

export const CLAMAV_CONFIG_DIR = join(__dirname, "..", "..", "..", "compose", "clamav");
export function clamavConfigFiles(): { "clamd.conf": string; "freshclam.conf": string } {
  return {
    "clamd.conf": readFileSync(join(CLAMAV_CONFIG_DIR, "clamd.conf"), "utf8"),
    "freshclam.conf": readFileSync(join(CLAMAV_CONFIG_DIR, "freshclam.conf"), "utf8"),
  };
}

export function readinessScript(): string {
  const maxAgeSeconds = CLAMAV.maxSignatureAgeHours * 3600;
  return [
    `reply=$(printf 'zVERSION\\0' | nc -w 5 127.0.0.1 ${CLAMAV.port} | tr -d '\\0')`,
    'built=$(date -u -D "%a %b %d %H:%M:%S %Y" -d "${reply##*/}" +%s) || exit 1',
    `[ $(( $(date -u +%s) - built )) -lt ${maxAgeSeconds} ]`,
  ].join("\n");
}

export function livenessScript(): string {
  return `[ "$(printf 'zPING\\0' | nc -w 5 127.0.0.1 ${CLAMAV.port} | tr -d '\\0')" = "PONG" ]`;
}

export const CLAMAV_DEPLOYMENT_ANNOTATIONS = { "pulumi.com/skipAwait": "true" } as const;

export function installClamAV(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  dependsOn: pulumi.Resource[],
): ClamAV {
  const { name } = CLAMAV;
  const labels = commonLabels(name);
  const { image } = cfg.malwareScan;
  const files = clamavConfigFiles();
  const shutdown = gracefulShutdown(ROLLOUT.converter, "coreutils");

  const startupBudgetSeconds = 10 * 30;
  assertStartupFitsRollout(name, ROLLOUT.converter, startupBudgetSeconds);

  const config = new k8s.core.v1.ConfigMap(
    `${name}-config`,
    { metadata: { name: `${name}-config`, namespace, labels }, data: files },
    { provider, dependsOn },
  );

  const asClamav = {
    ...hardenedContainerSecurityContext(),
    runAsNonRoot: true,
    runAsUser: CLAMAV.uid,
    runAsGroup: CLAMAV.gid,
  };
  const mounts = [
    { name: "database", mountPath: CLAMAV.databasePath },
    { name: "config", mountPath: `${CLAMAV.configPath}/clamd.conf`, subPath: "clamd.conf", readOnly: true },
    { name: "config", mountPath: `${CLAMAV.configPath}/freshclam.conf`, subPath: "freshclam.conf", readOnly: true },
  ];

  const deployment = new k8s.apps.v1.Deployment(
    name,
    {
      metadata: { name, namespace, labels, annotations: CLAMAV_DEPLOYMENT_ANNOTATIONS },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        ...surgeRollout(ROLLOUT.converter),
        template: {
          metadata: {
            labels,
            annotations: secretChecksumAnnotations(secretChecksum(files)),
          },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: shutdown.terminationGracePeriodSeconds,
            securityContext: { runAsNonRoot: true, runAsUser: CLAMAV.uid, runAsGroup: CLAMAV.gid, fsGroup: CLAMAV.gid },
            ...onNodeGroup(cfg.nodeGroups.batch),
            initContainers: [
              {
                name: "seed",
                image,
                imagePullPolicy: pullPolicyFor(image),
                securityContext: asClamav,
                command: ["sh", "-c", `cp ${CLAMAV.databasePath}/* /seed/`],
                volumeMounts: [{ name: "database", mountPath: "/seed" }],
                resources: CLAMAV.seedResources,
              },
            ],
            containers: [
              {
                name: "clamd",
                image,
                imagePullPolicy: pullPolicyFor(image),
                securityContext: asClamav,
                lifecycle: shutdown.lifecycle,
                command: ["clamd", "--foreground", `--config-file=${CLAMAV.configPath}/clamd.conf`],
                ports: [{ containerPort: CLAMAV.port, name: "clamd" }],
                volumeMounts: mounts,
                resources: CLAMAV.resources,
                startupProbe: {
                  exec: { command: ["sh", "-c", livenessScript()] },
                  periodSeconds: 10,
                  failureThreshold: startupBudgetSeconds / 10,
                },
                readinessProbe: {
                  exec: { command: ["sh", "-c", readinessScript()] },
                  periodSeconds: 30,
                  timeoutSeconds: 10,
                },
                livenessProbe: {
                  exec: { command: ["sh", "-c", livenessScript()] },
                  periodSeconds: 30,
                  timeoutSeconds: 10,
                  failureThreshold: 4,
                },
              },
              {
                name: "freshclam",
                image,
                imagePullPolicy: pullPolicyFor(image),
                securityContext: asClamav,
                command: ["freshclam", "--daemon", "--foreground", "--stdout", `--config-file=${CLAMAV.configPath}/freshclam.conf`],
                volumeMounts: mounts,
                resources: CLAMAV.freshclamResources,
              },
            ],
            volumes: [
              { name: "database", emptyDir: { sizeLimit: "2Gi" } },
              { name: "config", configMap: { name: config.metadata.name } },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [...dependsOn, config] },
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: { name, namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: CLAMAV.port, targetPort: CLAMAV.port, name: "clamd" }],
      },
    },
    { provider, dependsOn: deployment },
  );

  return { deployment, service, url: pulumi.output(`tcp://${name}:${CLAMAV.port}`) };
}
