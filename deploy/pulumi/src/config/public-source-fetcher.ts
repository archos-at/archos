import type * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";

export function publicSourceFetcherConfig(cfg: pulumi.Config): DeployConfig["publicSourceFetcher"] {
  return {
    replicas: cfg.getNumber("publicSourceFetcherReplicas") ?? 1,
  };
}
