import type * as pulumi from "@pulumi/pulumi";
import type { ImagesConfig } from "./images";
import { bool, percent, positiveInt } from "./readers";

export interface CodeRunnerConfig {
  enabled: boolean;
  image: string;
  minReplicas: number;
  maxReplicas: number;
  cpuTargetPercent: number;
  memoryTargetPercent: number;
}

export function codeRunnerImage(images: ImagesConfig, override: string | undefined): string {
  return override ?? `${images.registry}/code-runner:${images.tag}`;
}

export function loadCodeRunner(cfg: pulumi.Config, images: ImagesConfig): CodeRunnerConfig {
  const minReplicas = positiveInt(cfg, "codeRunnerMinReplicas", 2);
  const maxReplicas = positiveInt(cfg, "codeRunnerMaxReplicas", 10);
  if (maxReplicas < minReplicas) {
    throw new Error(
      `grid-oib:codeRunnerMaxReplicas (${maxReplicas}) must be >= codeRunnerMinReplicas (${minReplicas}).`,
    );
  }
  return {
    enabled: bool(cfg, "codeRunnerEnabled", false),
    image: codeRunnerImage(images, cfg.get("codeRunnerImage")),
    minReplicas,
    maxReplicas,
    cpuTargetPercent: percent(cfg, "codeRunnerCpuTargetPercent", 70),
    memoryTargetPercent: percent(cfg, "codeRunnerMemoryTargetPercent", 80),
  };
}
