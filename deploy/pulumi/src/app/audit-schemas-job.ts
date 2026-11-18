import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { appPullPolicy, frontendImage } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import { hardenedContainerSecurityContext } from "../platform/security";
import { JOB_DEFAULTS, LIGHT_WORKER_RESOURCES, UID } from "../constants";
import { AppSecrets, AppWiring } from "./config";
import { auditSchemaEnv } from "./job-env";
import { logicalName } from "../names";
import { scaledCpuRequest } from "../config/cpu-requests";

export function reconcileAuditSchemas(
  w: AppWiring,
  cfg: DeployConfig,
  secrets: AppSecrets,
  dependsOn: pulumi.Resource[],
): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    logicalName("grid-app-audit-schemas"),
    {
      metadata: { namespace: w.namespace },
      spec: {
        backoffLimit: JOB_DEFAULTS.backoffLimit,
        ttlSecondsAfterFinished: JOB_DEFAULTS.ttlSecondsAfterFinished,
        template: {
          metadata: { labels: commonLabels(logicalName("grid-app-audit-schemas")) },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            imagePullSecrets: w.imagePullSecrets,
            restartPolicy: "OnFailure",
            securityContext: { runAsNonRoot: true, runAsUser: UID.frontend, runAsGroup: UID.frontend },
            ...onNodeGroup(cfg.nodeGroups.app),
            containers: [
              {
                name: "audit-schemas",
                image: frontendImage(cfg),
                imagePullPolicy: appPullPolicy(cfg, frontendImage(cfg)),
                securityContext: hardenedContainerSecurityContext(),
                command: ["node", "scripts/provision-workos-audit-schemas.mjs", "--apply"],
                env: auditSchemaEnv(),
                resources: scaledCpuRequest(LIGHT_WORKER_RESOURCES),
              },
            ],
          },
        },
      },
    },
    { provider: w.provider, dependsOn: [secrets.secret, ...dependsOn] },
  );
}
