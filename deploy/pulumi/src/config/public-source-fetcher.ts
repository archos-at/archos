/**
 * The public-source fetcher's deploy config (ADR-0162), its own module beside `malware-scan.ts`.
 */

import type * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { bool } from "./readers";

/**
 * OFF by default (`publicSourceFetcherEnabled`): prepared, switched on per
 * stack. Off, no backend gets `PUBLIC_SOURCE_FETCHER_URL`, and an organization
 * with the `source-routing` flag runs the same guard inside the agent's pod.
 */
export function publicSourceFetcherConfig(cfg: pulumi.Config): DeployConfig["publicSourceFetcher"] {
  return {
    enabled: bool(cfg, "publicSourceFetcherEnabled", false),
    replicas: cfg.getNumber("publicSourceFetcherReplicas") ?? 1,
  };
}
