import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createHash } from "node:crypto";
import { objectName } from "../names";

export const SECRET_CHECKSUM_ANNOTATION = objectName("secretChecksumAnnotation"); // pragma: allowlist secret (annotation key name, not a credential)

export const REVISION_HISTORY_LIMIT = 5;

export interface RolloutProfile {
  minReadySeconds: number;
  progressDeadlineSeconds: number;
  terminationGracePeriodSeconds: number;
  endpointDrainSeconds: number;
}

export const FRONTEND_DRAIN_SECONDS = 30;

function assertFrontendBudgetFits(): void {
  const p = ROLLOUT.frontend;
  const needed = p.endpointDrainSeconds + FRONTEND_DRAIN_SECONDS;
  if (needed >= p.terminationGracePeriodSeconds) {
    throw new Error(
      `Invalid frontend shutdown budget: endpointDrainSeconds (${p.endpointDrainSeconds}) + ` +
        `FRONTEND_DRAIN_SECONDS (${FRONTEND_DRAIN_SECONDS}) = ${needed}s does not fit inside ` +
        `terminationGracePeriodSeconds (${p.terminationGracePeriodSeconds}s). Raise the grace ` +
        `period or shorten the drain.`,
    );
  }
}

export const API_DRAIN_SECONDS = 30;

function assertApiBudgetFits(): void {
  const p = ROLLOUT.api;
  const needed = p.endpointDrainSeconds + API_DRAIN_SECONDS;
  if (needed >= p.terminationGracePeriodSeconds) {
    throw new Error(
      `Invalid api shutdown budget: endpointDrainSeconds (${p.endpointDrainSeconds}) + ` +
        `API_DRAIN_SECONDS (${API_DRAIN_SECONDS}) = ${needed}s does not fit inside ` +
        `terminationGracePeriodSeconds (${p.terminationGracePeriodSeconds}s). Raise the grace ` +
        `period or shorten the drain.`,
    );
  }
}

export const startupBudgetSeconds = (periodSeconds: number, failureThreshold: number): number =>
  periodSeconds * failureThreshold;

export function assertStartupFitsRollout(
  workload: string,
  profile: RolloutProfile,
  probeBudgetSeconds: number,
  imagePullSlackSeconds = 120,
): void {
  const needed = probeBudgetSeconds + profile.minReadySeconds + imagePullSlackSeconds;
  if (needed >= profile.progressDeadlineSeconds) {
    throw new Error(
      `Invalid ${workload} rollout budget: startupProbe (${probeBudgetSeconds}s) + ` +
        `minReadySeconds (${profile.minReadySeconds}s) + image-pull slack ` +
        `(${imagePullSlackSeconds}s) = ${needed}s exceeds progressDeadlineSeconds ` +
        `(${profile.progressDeadlineSeconds}s). A healthy-but-slow first deploy would be ` +
        "reported as ProgressDeadlineExceeded while the container is still starting normally. " +
        "Raise the deadline or shorten the probe.",
    );
  }
}

export const ROLLOUT = {
  frontend: {
    minReadySeconds: 15,
    progressDeadlineSeconds: 900,
    terminationGracePeriodSeconds: 60,
    endpointDrainSeconds: 10,
  },

  api: {
    minReadySeconds: 30,
    progressDeadlineSeconds: 1200,
    terminationGracePeriodSeconds: 60,
    endpointDrainSeconds: 10,
  },

  backend: {
    minReadySeconds: 30,
    progressDeadlineSeconds: 0, // unused: StatefulSets have no progress deadline
    terminationGracePeriodSeconds: 90,
    endpointDrainSeconds: 10,
  },

  lightWorker: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    terminationGracePeriodSeconds: 30,
    endpointDrainSeconds: 0,
  },

  web: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    terminationGracePeriodSeconds: 30,
    endpointDrainSeconds: 5,
  },

  converter: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    terminationGracePeriodSeconds: 135,
    endpointDrainSeconds: 5,
  },

  dataPlane: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    terminationGracePeriodSeconds: 60,
    endpointDrainSeconds: 0,
  },

  vectorStore: {
    minReadySeconds: 30,
    progressDeadlineSeconds: 1800,
    terminationGracePeriodSeconds: 120,
    endpointDrainSeconds: 5,
  },

  observability: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    terminationGracePeriodSeconds: 30,
    endpointDrainSeconds: 0,
  },

  langfuse: {
    minReadySeconds: 10,
    progressDeadlineSeconds: 1200,
    terminationGracePeriodSeconds: 30,
    endpointDrainSeconds: 10,
  },
} as const satisfies Record<string, RolloutProfile>;

assertFrontendBudgetFits();
assertApiBudgetFits();

export const DRAIN_GIVE_BACK_SECONDS = 30;

export function agentWorkerRollout(drainSeconds: number): RolloutProfile {
  const grace = drainSeconds + DRAIN_GIVE_BACK_SECONDS;
  return {
    minReadySeconds: 30,
    progressDeadlineSeconds: grace * 2 + 900,
    terminationGracePeriodSeconds: grace,
    endpointDrainSeconds: 0,
  };
}

export const BACKEND_DRAIN_SLACK_SECONDS = 60;

export function backendRollout(drainSeconds: number): RolloutProfile {
  return {
    ...ROLLOUT.backend,
    terminationGracePeriodSeconds:
      ROLLOUT.backend.endpointDrainSeconds + drainSeconds + BACKEND_DRAIN_SLACK_SECONDS,
  };
}

export const SURGE_ONLY_STRATEGY = {
  type: "RollingUpdate",
  rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
} as const;

export const EDGE_SHUTDOWN = {
  minDrainDuration: "10s",
  drainTimeout: "60s",
} as const;

export function surgeRollout(p: RolloutProfile) {
  return {
    strategy: SURGE_ONLY_STRATEGY,
    minReadySeconds: p.minReadySeconds,
    progressDeadlineSeconds: p.progressDeadlineSeconds,
    revisionHistoryLimit: REVISION_HISTORY_LIMIT,
  };
}

export function recreateRollout(p: RolloutProfile) {
  return {
    strategy: { type: "Recreate" },
    minReadySeconds: p.minReadySeconds,
    progressDeadlineSeconds: p.progressDeadlineSeconds,
    revisionHistoryLimit: REVISION_HISTORY_LIMIT,
  };
}

export function orderedRollout(p: RolloutProfile) {
  return {
    updateStrategy: { type: "RollingUpdate" },
    minReadySeconds: p.minReadySeconds,
    revisionHistoryLimit: REVISION_HISTORY_LIMIT,
  };
}

export function gracefulShutdown(
  p: RolloutProfile,
  runtime?: "node" | "python" | "coreutils",
): {
  terminationGracePeriodSeconds: number;
  lifecycle?: k8s.types.input.core.v1.Lifecycle;
} {
  if (p.endpointDrainSeconds >= p.terminationGracePeriodSeconds) {
    throw new Error(
      `Invalid rollout profile: endpointDrainSeconds (${p.endpointDrainSeconds}) must be less ` +
        `than terminationGracePeriodSeconds (${p.terminationGracePeriodSeconds}) — the preStop ` +
        `hook is spent from the same grace budget, so the container would be SIGKILLed before ` +
        `it ever saw SIGTERM.`,
    );
  }
  const base = { terminationGracePeriodSeconds: p.terminationGracePeriodSeconds };
  if (p.endpointDrainSeconds <= 0 || runtime === undefined) return base;
  const command =
    runtime === "node"
      ? ["node", "-e", `setTimeout(() => {}, ${p.endpointDrainSeconds * 1000})`]
      : runtime === "python"
        ? ["python", "-c", `import time; time.sleep(${p.endpointDrainSeconds})`]
        : ["sleep", String(p.endpointDrainSeconds)];
  return { ...base, lifecycle: { preStop: { exec: { command } } } };
}

export function secretChecksum(
  values: Record<string, pulumi.Input<string>>,
): pulumi.Output<string> {
  return pulumi.unsecret(
    pulumi.output(values).apply((resolved) => {
      const hash = createHash("sha256");
      for (const key of Object.keys(resolved).sort()) {
        hash.update(key).update("\u0000").update(resolved[key] ?? "").update("\u0000");
      }
      return hash.digest("hex").slice(0, 16);
    }),
  );
}

export function secretChecksumAnnotations(
  checksum: pulumi.Input<string>,
): Record<string, pulumi.Input<string>> {
  return { [SECRET_CHECKSUM_ANNOTATION]: checksum };
}
