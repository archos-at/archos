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

/** The bundles and their manifest, as the frontend image copies them (`apps/workspace/deploy/Dockerfile`). */
export const KNOWLEDGE_RELEASES_DIR = resolve(__dirname, "../../../../apps/workspace/config/knowledge-releases");

/**
 * The names the carry sets itself. `KNOWLEDGE_SINGLE_OPERATOR=true` is this
 * pod's alone (`stack-files.spec.ts` holds that nothing else sets it on prod):
 * migration 0233 then counts the carry's own verdicts and leaves no second
 * review due, which is what ADR-0181 decided for this carry and nothing else.
 */
const CARRY_OVERRIDES = new Set(["KNOWLEDGE_SINGLE_OPERATOR", "OTEL_SERVICE_NAME"]);

/**
 * How long the carry waits for the corpus to ingest a country's texts, in minutes. Prod's first AT carry
 * (2026-11-14) indexed one new text about every three minutes, 54 texts in about 2.5 hours; at 30 minutes every
 * attempt ran out first and the labels, the legacy copies and the building classes were left undone.
 */
export const CARRY_WAIT_MINUTES = 240;

/**
 * The digest the Job's name carries: the manifest and every bundle it names, so
 * a deploy that changes no bundle plans no new Job and one that changes any
 * runs the carry again (which skips what stable already holds).
 */
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

/**
 * The promotion's carry of reviewed knowledge releases (ADR-0181): one Job from
 * the frontend image running `node dist-jobs/knowledge-carry.mjs`, gated by the
 * stack's `knowledgeCarry`. Per bundle it verifies the digest, imports, attaches
 * each text from its URL through the public-source fetcher, reviews and
 * approves `carried`, publishes to preview and stable, then waits for the corpus
 * to ingest every text with its country's mark. On the target it then derives
 * every live project's building class again (`rederiveBuildingClasses`), the
 * rollover's one-time step, so no operator runs it by hand.
 *
 * So it waits on what it calls: the migrated schema (0239), the api tier (the
 * corpus and the fetch), the fetcher, the bff-jobs pool (it runs the index
 * runs) and the ingest workers (they cut the chunks).
 *
 * NOT AWAITED (`pulumi.com/skipAwait`). The ingest of a country's texts (AT:
 * about 50 PDFs, chunked on their Punkte) is bounded by KEDA's scale-up and the
 * ingest pool, and the carry waits up to `CARRY_WAIT_MINUTES` for it after the
 * fetches. Awaited, that would sit inside the deploy's 60-minute job budget
 * behind every tier's rollout, and a deploy that times out there has rolled
 * everything already: failing it would roll nothing back. The Job reports
 * instead: one JSON log line per step, a non-zero exit on any failure, retried
 * (`backoffLimit`) from where the request stands. Read it with
 * `kubectl logs job/<name>`; rollover-to-prod.md says what green looks like.
 */
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
        annotations: { "pulumi.com/skipAwait": "true" },
      },
      spec: {
        // Each retry resumes the request where it stands; three are enough for a fetch or an ingest that hiccups.
        backoffLimit: 3,
        // A day to read its log before the cluster reaps it.
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
