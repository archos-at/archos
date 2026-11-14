/**
 * The public-source fetcher's deploy config (ADR-0162), its own module beside `malware-scan.ts`.
 */

import type * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";

/**
 * Always deployed: the backend reads public sources, and parses their PDFs, only through it (ADR-0162
 * amendment). The `publicSourceFetcherEnabled` switch is gone; only the replica count is a stack's to set.
 */
export function publicSourceFetcherConfig(cfg: pulumi.Config): DeployConfig["publicSourceFetcher"] {
  return {
    replicas: cfg.getNumber("publicSourceFetcherReplicas") ?? 1,
  };
}
