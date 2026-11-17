import type * as k8s from "@pulumi/kubernetes";
import type { DeployConfig } from "../config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export function posthogEnv(cfg: DeployConfig): EnvVar[] {
  const { host, projectToken, releaseId } = cfg.posthog;
  if (host === "" || projectToken === "") return [];
  return [
    { name: "POSTHOG_HOST", value: host },
    { name: "POSTHOG_PROJECT_TOKEN", value: projectToken },
    { name: "POSTHOG_APP_HOST", value: cfg.ingress.appDomain },
    ...(releaseId === "" ? [] : [{ name: "POSTHOG_RELEASE_ID", value: releaseId }]),
  ];
}

export function webPosthogEnv(cfg: DeployConfig): EnvVar[] {
  const { host, projectToken } = cfg.posthog;
  if (host === "" || projectToken === "") return [];
  return [
    { name: "PUBLIC_POSTHOG_HOST", value: host },
    { name: "PUBLIC_POSTHOG_PROJECT_TOKEN", value: projectToken },
  ];
}
