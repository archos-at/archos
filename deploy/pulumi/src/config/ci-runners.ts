import * as pulumi from "@pulumi/pulumi";
import { bool, nodeGroup, num } from "./readers";

export interface CiRunnersConfig {
  enabled: boolean;
  githubConfigUrl: string;
  githubApp: { appId: string; installationId: string; privateKey: pulumi.Output<string> };
  image: string;
  scaleSetName: string;
  minRunners: number;
  maxRunners: number;
  resources: { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } };
  scratch: { storageClass: string; size: string };
  nodeGroup?: string;
}

export const CI_RUNNERS_SCALE_SET = "dev-cluster";
const DIGEST_PINNED = /@sha256:[a-f0-9]{64}$/;

export function loadCiRunners(cfg: pulumi.Config): CiRunnersConfig {
  const runners: CiRunnersConfig = {
    enabled: bool(cfg, "ciRunnersEnabled", false),
    githubConfigUrl: cfg.get("ciRunnersGithubConfigUrl") ?? "https://github.com/archos-at/archos",
    githubApp: {
      appId: cfg.get("ciRunnersGithubAppId") ?? "",
      installationId: cfg.get("ciRunnersGithubAppInstallationId") ?? "",
      privateKey: cfg.getSecret("ciRunnersGithubAppPrivateKey") ?? pulumi.secret(""),
    },
    image: cfg.get("ciRunnersImage")?.trim() ?? "",
    scaleSetName: cfg.get("ciRunnersScaleSetName") ?? CI_RUNNERS_SCALE_SET,
    minRunners: Math.max(0, num(cfg, "ciRunnersMinRunners", 0)),
    maxRunners: Math.max(1, num(cfg, "ciRunnersMaxRunners", 3)),
    resources: {
      requests: {
        cpu: cfg.get("ciRunnersRequestsCpu") ?? "250m",
        memory: cfg.get("ciRunnersRequestsMemory") ?? "4Gi",
      },
      limits: {
        cpu: cfg.get("ciRunnersLimitsCpu") ?? "3",
        memory: cfg.get("ciRunnersLimitsMemory") ?? "7Gi",
      },
    },
    scratch: {
      storageClass: cfg.get("ciRunnersScratchStorageClass") ?? cfg.require("storageClass"),
      size: cfg.get("ciRunnersScratchSize") ?? "15Gi",
    },
    nodeGroup: nodeGroup(cfg, "ciRunnersNodeGroup"),
  };
  if (runners.enabled) refuseUnsafeCiRunners(cfg, runners);
  return runners;
}

function refuseUnsafeCiRunners(cfg: pulumi.Config, runners: CiRunnersConfig): void {
  if (!bool(cfg, "networkPolicies", true)) {
    throw new Error(
      "grid-oib:ciRunnersEnabled requires grid-oib:networkPolicies: a runner runs a pull request's code, " +
        "and its NetworkPolicy is what keeps it off every in-cluster address but DNS.",
    );
  }
  const hasPrivateKey = cfg.getSecret("ciRunnersGithubAppPrivateKey") !== undefined;
  if (!runners.githubApp.appId || !runners.githubApp.installationId || !hasPrivateKey) {
    throw new Error(
      "grid-oib:ciRunnersEnabled needs the GitHub App the controller registers runners with: " +
        "ciRunnersGithubAppId, ciRunnersGithubAppInstallationId and (with --secret) ciRunnersGithubAppPrivateKey.",
    );
  }
  if (!DIGEST_PINNED.test(runners.image)) {
    throw new Error(
      `grid-oib:ciRunnersImage must name the runner image by digest (<image>@sha256:<64 hex>), got "${runners.image}": ` +
        "a tag lets the toolchain change under a pull request that did not change it.",
    );
  }
  if (runners.minRunners > runners.maxRunners) {
    throw new Error(
      `grid-oib:ciRunnersMinRunners (${runners.minRunners}) exceeds ciRunnersMaxRunners (${runners.maxRunners}).`,
    );
  }
}
