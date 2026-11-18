import * as k8s from "@pulumi/kubernetes";
import { onNodeGroup } from "../platform/scheduling";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from '../config'
import { pullPolicyFor } from '../config/images'
import { commonLabels } from "../platform/namespaces";
import {
  ROLLOUT,
  gracefulShutdown,
  recreateRollout,
  secretChecksum,
  secretChecksumAnnotations,
  surgeRollout,
} from "../platform/rollout";
import { DATA_RESOURCES, EDGE_RATE_LIMIT, LANGFUSE, PORT } from "../constants";
import { scrapeAnnotations } from "../platform/scrape";
import { scaledCpuRequest } from "../config/cpu-requests";

const DRAGONFLY_IMAGE = "docker.dragonflydb.io/dragonflydb/dragonfly:latest";

const REQUIREPASS_ENV = "DFLY_requirepass";

export interface Dragonfly {
  service: k8s.core.v1.Service;
  url: pulumi.Output<string>;
  hostPort: pulumi.Output<string>;
  password?: pulumi.Output<string>;
}

interface DragonflyOptions {
  name: string;
  maxmemory: string;
  memoryLimit: string;
  cacheMode: boolean;
  allowUndeclaredLuaKeys?: boolean;
  recreateOnRollout?: boolean;
  password?: pulumi.Output<string>;
  nodeGroup: string | undefined;
}

function installDragonflyInstance(
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
  opts: DragonflyOptions,
): Dragonfly {
  const maxmemoryMatch = /^(\d+)\s*(mb|gb)$/i.exec(opts.maxmemory);
  const maxmemoryMib = maxmemoryMatch
    ? Number(maxmemoryMatch[1]) * (maxmemoryMatch[2].toLowerCase() === "gb" ? 1024 : 1)
    : 0;
  if (maxmemoryMib < 256) {
    throw new Error(
      `${opts.name}: --maxmemory=${opts.maxmemory} is below Dragonfly's 256mb-per-thread boot floor (proactor_threads=1)`,
    );
  }

  const labels = commonLabels(opts.name);

  const authSecretName = `${opts.name}-auth`; // pragma: allowlist secret (Kubernetes Secret resource name, not a credential)
  const authValues = opts.password ? { [REQUIREPASS_ENV]: opts.password } : undefined;
  const authSecret = authValues
    ? new k8s.core.v1.Secret(
        authSecretName,
        {
          metadata: { name: authSecretName, namespace, labels },
          stringData: authValues,
        },
        { provider },
      )
    : undefined;
  const authAnnotations = authValues
    ? secretChecksumAnnotations(secretChecksum(authValues))
    : {};
  const authEnv = authSecret
    ? [
        {
          name: REQUIREPASS_ENV,
          valueFrom: { secretKeyRef: { name: authSecretName, key: REQUIREPASS_ENV } },
        },
      ]
    : [];

  const deployment = new k8s.apps.v1.Deployment(
    opts.name,
    {
      metadata: { name: opts.name, namespace, labels },
      spec: {
        replicas: 1,
        ...(opts.recreateOnRollout
          ? recreateRollout(ROLLOUT.dataPlane)
          : surgeRollout(ROLLOUT.dataPlane)),
        selector: { matchLabels: labels },
        template: {
          metadata: { labels, annotations: { ...authAnnotations, ...scrapeAnnotations(PORT.redis) } },
          spec: {
            enableServiceLinks: false, // see platform/security.ts — service-link env collisions
            terminationGracePeriodSeconds:
              gracefulShutdown(ROLLOUT.dataPlane).terminationGracePeriodSeconds,
            ...onNodeGroup(opts.nodeGroup),
            containers: [
              {
                name: "dragonfly",
                image: DRAGONFLY_IMAGE,
                imagePullPolicy: pullPolicyFor(DRAGONFLY_IMAGE),
                args: [
                  "--logtostderr",
                  "--force_epoll",
                  "--proactor_threads=1",
                  `--maxmemory=${opts.maxmemory}`,
                  `--cache_mode=${opts.cacheMode}`,
                  ...(opts.allowUndeclaredLuaKeys
                    ? ["--default_lua_flags=allow-undeclared-keys"]
                    : []),
                  "--dbfilename=",
                ],
                env: authEnv,
                ports: [{ containerPort: PORT.redis, name: "redis" }],
                resources: {
                  requests: scaledCpuRequest({ requests: DATA_RESOURCES.dragonflyRequests }).requests,
                  limits: { cpu: DATA_RESOURCES.dragonflyCpuLimit, memory: opts.memoryLimit },
                },
                readinessProbe: {
                  tcpSocket: { port: PORT.redis },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
              },
            ],
          },
        },
      },
    },
    { provider, ...(authSecret ? { dependsOn: authSecret } : {}) },
  );

  const service = new k8s.core.v1.Service(
    opts.name,
    {
      metadata: { name: opts.name, namespace, labels },
      spec: {
        selector: labels,
        ports: [{ port: PORT.redis, targetPort: PORT.redis, name: "redis" }],
      },
    },
    { provider, dependsOn: deployment },
  );

  const url = opts.password
    ? opts.password.apply(
        (pw) => `redis://:${encodeURIComponent(pw)}@${opts.name}:${PORT.redis}/0`,
      )
    : pulumi.output(`redis://${opts.name}:${PORT.redis}/0`);

  return {
    service,
    url,
    hostPort: pulumi.output(`${opts.name}:${PORT.redis}`),
    password: opts.password,
  };
}

export function installDragonfly(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): Dragonfly {
  return installDragonflyInstance(provider, namespace, {
    name: "dragonfly",
    nodeGroup: cfg.nodeGroups.data,
    maxmemory: cfg.dragonfly.maxmemory,
    memoryLimit: cfg.dragonfly.memoryLimit,
    cacheMode: true,
    password: cfg.dragonfly.password,
  });
}

export function installRateLimitStore(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): Dragonfly {
  return installDragonflyInstance(provider, namespace, {
    name: EDGE_RATE_LIMIT.storeService,
    nodeGroup: cfg.nodeGroups.data,
    maxmemory: cfg.rateLimit.storeMaxmemory,
    memoryLimit: cfg.rateLimit.storeMemoryLimit,
    cacheMode: false,
    recreateOnRollout: true,
    password: cfg.rateLimit.storePassword,
  });
}

export function installLangfuseQueue(
  cfg: DeployConfig,
  provider: k8s.Provider,
  namespace: pulumi.Input<string>,
): Dragonfly {
  return installDragonflyInstance(provider, namespace, {
    name: LANGFUSE.queue,
    nodeGroup: cfg.nodeGroups.data,
    maxmemory: cfg.langfuse.queueMaxmemory,
    memoryLimit: cfg.langfuse.queueMemoryLimit,
    cacheMode: false,
    recreateOnRollout: true,
    allowUndeclaredLuaKeys: true,
    password: cfg.langfuse.queuePassword,
  });
}
