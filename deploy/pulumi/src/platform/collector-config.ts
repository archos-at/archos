import { dump } from "js-yaml";

export type Signal = "traces" | "logs" | "metrics";
export const SIGNALS: readonly Signal[] = ["traces", "logs", "metrics"];

export type ComponentConfig = Record<string, unknown> | null;

export interface Pipeline {
  receivers: string[];
  processors?: string[];
  exporters: string[];
}

export interface CollectorFragment {
  receivers?: Record<string, ComponentConfig>;
  processors?: Record<string, ComponentConfig>;
  exporters?: Record<string, ComponentConfig>;
  pipelines?: Record<string, Pipeline>;
}

export interface CollectorConfig {
  receivers: Record<string, ComponentConfig>;
  processors: Record<string, ComponentConfig>;
  exporters: Record<string, ComponentConfig>;
  extensions: Record<string, ComponentConfig>;
  service: {
    extensions: string[];
    pipelines: Record<string, { receivers: string[]; processors: string[]; exporters: string[] }>;
  };
}

export const OTLP_GRPC_PORT = 4317;
export const OTLP_HTTP_PORT = 4318;
export const SHIPPER_OTLP_PORT = 4319;
export const HEALTH_PORT = 13133;

export const OTLP_RECEIVER = "otlp";

const BASE_PROCESSORS: Record<string, ComponentConfig> = {
  memory_limiter: { check_interval: "1s", limit_percentage: 80, spike_limit_percentage: 25 },
  batch: { timeout: "5s", send_batch_size: 1024 },
};

export function boundedDelivery(queueSize: number): Record<string, unknown> {
  return {
    sending_queue: { enabled: true, queue_size: queueSize },
    retry_on_failure: { enabled: true, initial_interval: "5s", max_interval: "30s", max_elapsed_time: "300s" },
  };
}

export function pipelineSignal(name: string): Signal {
  const signal = name.split("/")[0] as Signal;
  if (!SIGNALS.includes(signal)) throw new Error(`collector pipeline "${name}" names no signal`);
  return signal;
}

function mergeUnique<T>(kind: string, into: Record<string, T>, from: Record<string, T> | undefined): void {
  for (const [name, value] of Object.entries(from ?? {})) {
    if (name in into) throw new Error(`collector ${kind} "${name}" is declared twice`);
    into[name] = value;
  }
}

export function composeCollectorConfig(
  fragments: CollectorFragment[],
  { otlpReceiver = true }: { otlpReceiver?: boolean } = {},
): CollectorConfig {
  const receivers: Record<string, ComponentConfig> = otlpReceiver
    ? {
        [OTLP_RECEIVER]: {
          protocols: {
            grpc: { endpoint: `0.0.0.0:${OTLP_GRPC_PORT}` },
            http: { endpoint: `0.0.0.0:${OTLP_HTTP_PORT}` },
          },
        },
      }
    : {};
  const processors: Record<string, ComponentConfig> = { ...BASE_PROCESSORS };
  const exporters: Record<string, ComponentConfig> = {};
  const pipelines: Record<string, Pipeline> = {};
  for (const fragment of fragments) {
    mergeUnique("receiver", receivers, fragment.receivers);
    mergeUnique("processor", processors, fragment.processors);
    mergeUnique("exporter", exporters, fragment.exporters);
    mergeUnique("pipeline", pipelines, fragment.pipelines);
  }
  Object.keys(pipelines).forEach(pipelineSignal);

  if (otlpReceiver) {
    for (const signal of SIGNALS) {
      const carried = Object.entries(pipelines).some(
        ([name, p]) => pipelineSignal(name) === signal && p.receivers.includes(OTLP_RECEIVER),
      );
      if (carried) continue;
      exporters.nop ??= null;
      mergeUnique("pipeline", pipelines, { [signal]: { receivers: [OTLP_RECEIVER], exporters: ["nop"] } });
    }
  }

  return {
    receivers,
    processors,
    exporters,
    extensions: { health_check: { endpoint: `0.0.0.0:${HEALTH_PORT}` } },
    service: {
      extensions: ["health_check"],
      pipelines: Object.fromEntries(
        Object.entries(pipelines).map(([name, p]) => [
          name,
          { ...p, processors: ["memory_limiter", ...(p.processors ?? []), "batch"] },
        ]),
      ),
    },
  };
}

export function renderCollectorConfig(config: CollectorConfig): string {
  return dump(config, { lineWidth: -1, noRefs: true, sortKeys: false });
}
