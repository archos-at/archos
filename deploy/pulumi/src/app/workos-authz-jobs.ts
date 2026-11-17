import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, frontendImage } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import { JOB_DEFAULTS, LIGHT_WORKER_RESOURCES, UID } from "../constants";
import { AppSecrets, AppWiring } from "./config";
import { authzCatalogEnv, folderGrantsCarryOverEnv } from "./job-env";
import { logicalName } from "../names";

type EnvVar = k8s.types.input.core.v1.EnvVar;

function workosJob(
  name: string,
  container: string,
  script: string,
  env: EnvVar[],
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    name,
    {
      metadata: { namespace: w.namespace },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels: commonLabels(name) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            restartPolicy: "OnFailure",
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: container,
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["node", `dist-scripts/${script}`, "--apply"],
                env,
                resources: LIGHT_WORKER_RESOURCES,
              },
            ],
          },
        },
      },
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );
}

export function reconcileAuthzCatalog(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  return workosJob(
    logicalName("grid-app-authz-catalog"),
    "authz-catalog",
    "provision-workos-authz.mjs",
    authzCatalogEnv(cfg),
    w,
    cfg,
    secrets,
    dependsOn,
  );
}

export function carryOverFolderGrants(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  return workosJob(
    logicalName("grid-app-folder-grants"),
    "folder-grants",
    "migrate-folder-grants-to-workos.mjs",
    folderGrantsCarryOverEnv(),
    w,
    cfg,
    secrets,
    dependsOn,
  );
}
