/** PostHog's env pairs for the Python tiers and the landing site, read from the stack's `posthog` keys. */

import type * as k8s from "@pulumi/kubernetes";
import type { DeployConfig } from "../config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/**
 * The Python tiers' PostHog pair (`POSTHOG_HOST`, `POSTHOG_PROJECT_TOKEN`), or
 * nothing unless both are configured, plus `POSTHOG_RELEASE_ID` when the deploy
 * resolved a release for the backend image (posthog-python reads it itself and
 * sends it as `$release_id`). Exported for `posthog.spec.ts`.
 */
export function posthogEnv(cfg: DeployConfig): EnvVar[] {
  const { host, projectToken, releaseId } = cfg.posthog;
  if (host === "" || projectToken === "") return [];
  return [
    { name: "POSTHOG_HOST", value: host },
    { name: "POSTHOG_PROJECT_TOKEN", value: projectToken },
    ...(releaseId === "" ? [] : [{ name: "POSTHOG_RELEASE_ID", value: releaseId }]),
  ];
}

/**
 * The landing site's PostHog pair (`PUBLIC_POSTHOG_HOST`,
 * `PUBLIC_POSTHOG_PROJECT_TOKEN`), or nothing unless both are configured: the
 * same stack keys the other runtimes read, under the names the Astro tier uses.
 * `apps/website/src/pages/web-analytics.js.ts` reads them per request (the
 * pages are prerendered and the image builds with no env files) and answers an
 * empty script without them. Exported for `web.spec.ts`.
 */
export function webPosthogEnv(cfg: DeployConfig): EnvVar[] {
  const { host, projectToken } = cfg.posthog;
  if (host === "" || projectToken === "") return [];
  return [
    { name: "PUBLIC_POSTHOG_HOST", value: host },
    { name: "PUBLIC_POSTHOG_PROJECT_TOKEN", value: projectToken },
  ];
}
