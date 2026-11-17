import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { appPullPolicy, frontendImage } from "../config/images";
import { commonLabels } from "../platform/namespaces";
import { onNodeGroup } from "../platform/scheduling";
import { hardenedContainerSecurityContext } from "../platform/security";
import { UID } from "../constants";
import { AppSecrets, AppWiring, frontendEnv } from "./config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export const KNOWLEDGE_RELEASES_DIR = resolve(__dirname, "../../../../apps/workspace/config/knowledge-releases");

const CARRY_OVERRIDES = new Set(["KNOWLEDGE_SINGLE_OPERATOR", "OTEL_SERVICE_NAME"]);

export const CARRY_WAIT_MINUTES = 240;

export function knowledgeReleasesDigest(dir = KNOWLEDGE_RELEASES_DIR): string {
  const hash = createHash("sha256");
  const manifest = readFileSync(resolve(dir, "manifest.json"));
  hash.update(manifest);
  const { bundles } = JSON.parse(manifest.toString("utf8")) as { bundles: { file: string }[] };
  for (const { file } of bundles) {
    const path = resolve(dir, file);
    if (!existsSync(path)) throw new Error(`the carry manifest names ${file}, which ${dir} does not hold`);
    hash.update(file).update(readFileSync(path));
  }
  return hash.digest("hex").slice(0, 10);
}

export function knowledgeCarryEnv(w: AppWiring, cfg: DeployConfig): EnvVar[] {
  return [
    ...frontendEnv(w).filter((env) => typeof env.name !== "string" || !CARRY_OVERRIDES.has(env.name)),
    { name: "KNOWLEDGE_SINGLE_OPERATOR", value: "true" },
    { name: "KNOWLEDGE_CARRY_DEPLOYMENT", value: pulumi.getStack() },
    { name: "KNOWLEDGE_CARRY_PROMOTION", value: `image ${cfg.images.tag}` },
    { name: "KNOWLEDGE_CARRY_WAIT_MINUTES", value: String(CARRY_WAIT_MINUTES) },
    ...(cfg.observability.enabled ? [{ name: "OTEL_SERVICE_NAME", value: "knowledge-carry" }] : []),
  ];
}

export function runKnowledgeCarry(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  const name = `knowledge-carry-${knowledgeReleasesDigest()}`;
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: {
        name,
        namespace: w.namespace,
        annotations: {
          "pulumi.com/skipAwait": "true",
          // prod 2026-11-14: foreground deletion kept the old Job until its pod was gone, so the replace met "already exists".
          "pulumi.com/deletionPropagationPolicy": "background",
        },
      },
      spec: {
        backoffLimit: 3,
        ttlSecondsAfterFinished: 86_400,
        template: {
          metadata: { labels: commonLabels("knowledge-carry") },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            restartPolicy: "Never",
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "carry",
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["node", "dist-jobs/knowledge-carry.mjs"],
                env: knowledgeCarryEnv(w, cfg),
                resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } },
              },
            ],
          },
        },
      },
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );
}
