import { load } from "js-yaml";
import type { CollectorConfig } from "../platform/collector-config";

export function parseCollectorConfig(yaml: string): CollectorConfig {
  return load(yaml) as CollectorConfig;
}

export function pipeline(exporters: string[], { receivers = ["otlp"], processors = [] as string[] } = {}) {
  return { receivers, processors: ["memory_limiter", ...processors, "batch"], exporters };
}
