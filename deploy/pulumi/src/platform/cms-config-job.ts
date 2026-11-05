/**
 * The CMS's configuration as code (ADR-0155): on every deploy whose sync files
 * changed, a Job pushes `apps/cms/directus` (schema, roles, policies,
 * permissions, flows, dashboards, settings) into Directus with the official
 * Environment Sync CLI (`d6s sync push`), then runs `apps/cms/scripts/provision.mjs`
 * for what the sync files do not hold (the locales, the LinkedIn account, the
 * robot users and their tokens).
 *
 * `merge` mode: it creates and updates, never deletes. Removing a field or a
 * policy is a person's `d6s sync push --mode mirror --dangerously-allow-delete`
 * (apps/cms/README.md), because a delete in the CMS can drop content.
 *
 * The Job's name carries a hash of what it pushes, so an unchanged deploy does
 * not re-run it and a changed one does.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { CMS } from "../config/cms";
import { JOB_DEFAULTS } from "../constants";
import { CMS_INTERNAL_URL, CMS_PING_PATH } from "./cms";
import { commonLabels } from "./namespaces";
import { onNodeGroup } from "./scheduling";
import { hardenedContainerSecurityContext } from "./security";

/** apps/cms, from this file (deploy/pulumi/src/platform). */
export const CMS_APP_DIR = resolve(__dirname, "../../../../apps/cms");
/** The files the Job needs, relative to apps/cms. */
const SCRIPTS = ["scripts/provision.mjs", "scripts/lib/directus.mjs"];
/** The profile the Job pushes to; its token is `DIRECTUS_CLUSTER_TOKEN`. */
const PROFILE = "cluster";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Every file the Job mounts, by its path under the work directory. The sync
 * files are read at plan time, so `pulumi preview` shows a changed file as a
 * changed ConfigMap. `id_map.json` is left out: it maps a pulling instance's ids
 * to a pushed one's, and the cluster's ids equal the files' (a push creates
 * records with the ids it was given).
 */
export function cmsConfigFiles(appDir = CMS_APP_DIR): Record<string, string> {
  const sync = filesUnder(join(appDir, "directus"))
    .map((path) => relative(appDir, path))
    .filter((path) => path.endsWith(".json") && !path.endsWith("id_map.json"));
  const files: Record<string, string> = Object.fromEntries(
    [...sync, ...SCRIPTS].sort().map((path) => [path, readFileSync(join(appDir, path), "utf8")]),
  );
  files["directus.config.json"] = JSON.stringify(
    { profiles: { [PROFILE]: { url: CMS_INTERNAL_URL, auth: { type: "token" } } } },
    null,
    2,
  );
  return files;
}

/** A ConfigMap key may not hold `/`; the mount puts each file back at its path. */
const keyOf = (path: string) => path.replace(/\//g, "__");

/** The Job's shell: wait for Directus, push, provision. */
export function cmsConfigScript(cliVersion: string): string {
  return [
    "set -eu",
    "mkdir -p /tmp/work && cp -rL /config/. /tmp/work/ && cd /tmp/work",
    `until wget -q -O /dev/null "${CMS_INTERNAL_URL}${CMS_PING_PATH}"; do echo 'waiting for Directus'; sleep 5; done`,
    `npx --yes @directus/cli@${cliVersion} sync push --to ${PROFILE} --yes --no-interactive`,
    "node scripts/provision.mjs",
  ].join("\n");
}

export function installCmsConfigJob(cfg: DeployConfig, provider: k8s.Provider, dependsOn: pulumi.Resource[]): k8s.batch.v1.Job {
  const namespace = CMS.namespace;
  const labels = commonLabels("cms-config");
  const files = cmsConfigFiles();
  const hash = createHash("sha256").update(JSON.stringify(files)).update(cfg.cms.cliVersion).digest("hex").slice(0, 10);
  const configMap = new k8s.core.v1.ConfigMap(
    "cms-config-files",
    { metadata: { namespace, labels }, data: Object.fromEntries(Object.entries(files).map(([path, text]) => [keyOf(path), text])) },
    { provider, dependsOn },
  );
  const secret = new k8s.core.v1.Secret(
    "cms-config-tokens",
    {
      metadata: { namespace, labels },
      stringData: {
        DIRECTUS_CLUSTER_TOKEN: cfg.cms.adminToken,
        DIRECTUS_ADMIN_TOKEN: cfg.cms.adminToken,
        CMS_WEBSITE_TOKEN: cfg.cms.websiteToken,
        CMS_SOCIAL_HANDOFF_TOKEN: cfg.cms.socialHandoffToken,
      },
    },
    { provider, dependsOn },
  );
  return new k8s.batch.v1.Job(
    `cms-config-${hash}`,
    {
      metadata: { name: `cms-config-${hash}`, namespace, labels },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels },
          spec: {
            enableServiceLinks: false,
            automountServiceAccountToken: false,
            restartPolicy: "OnFailure",
            securityContext: { runAsNonRoot: true, runAsUser: CMS.uid, runAsGroup: CMS.uid, seccompProfile: { type: "RuntimeDefault" } },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "sync",
                image: cfg.cms.syncImage,
                securityContext: hardenedContainerSecurityContext(),
                command: ["/bin/sh", "-c"],
                args: [cmsConfigScript(cfg.cms.cliVersion)],
                env: [
                  // `CI` makes the CLI ignore saved credentials and never prompt.
                  { name: "CI", value: "1" },
                  { name: "HOME", value: "/tmp" },
                  { name: "npm_config_cache", value: "/tmp/npm" },
                  { name: "DIRECTUS_URL", value: CMS_INTERNAL_URL },
                ],
                envFrom: [{ secretRef: { name: secret.metadata.name } }],
                resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "1", memory: "512Mi" } },
                volumeMounts: [{ name: "config", mountPath: "/config", readOnly: true }],
              },
            ],
            volumes: [
              {
                name: "config",
                configMap: {
                  name: configMap.metadata.name,
                  items: Object.keys(files).map((path) => ({ key: keyOf(path), path })),
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [configMap, secret, ...dependsOn], customTimeouts: { create: "15m", update: "15m" } },
  );
}
