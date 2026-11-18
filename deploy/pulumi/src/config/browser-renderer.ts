import type * as pulumi from "@pulumi/pulumi";
import type { ImagesConfig } from "./images";
import { bool, percent, positiveInt } from "./readers";

export interface BrowserRendererConfig {
  enabled: boolean;
  image: string;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerPod: number;
  cpuTargetPercent: number;
  memoryTargetPercent: number;
}

export function browserRendererImage(images: ImagesConfig, override: string | undefined): string {
  return override ?? `${images.registry}/browser-renderer:${images.tag}`;
}

export function loadBrowserRenderer(cfg: pulumi.Config, images: ImagesConfig, codeRunnerEnabled: boolean): BrowserRendererConfig {
  const enabled = bool(cfg, "browserRendererEnabled", false);
  if (enabled && !codeRunnerEnabled) {
    throw new Error("grid-oib:browserRendererEnabled needs grid-oib:codeRunnerEnabled: the code runner is its only caller.");
  }
  const minReplicas = positiveInt(cfg, "browserRendererMinReplicas", 1);
  const maxReplicas = positiveInt(cfg, "browserRendererMaxReplicas", 3);
  if (maxReplicas < minReplicas) {
    throw new Error(
      `grid-oib:browserRendererMaxReplicas (${maxReplicas}) must be >= browserRendererMinReplicas (${minReplicas}).`,
    );
  }
  return {
    enabled,
    image: browserRendererImage(images, cfg.get("browserRendererImage")),
    minReplicas,
    maxReplicas,
    sessionsPerPod: positiveInt(cfg, "browserRendererSessionsPerPod", 2),
    cpuTargetPercent: percent(cfg, "browserRendererCpuTargetPercent", 70),
    memoryTargetPercent: percent(cfg, "browserRendererMemoryTargetPercent", 80),
  };
}
