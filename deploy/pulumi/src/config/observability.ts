import * as pulumi from "@pulumi/pulumi";

export interface ObservabilityConfig {
  enabled: boolean;
  collectorImage: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: pulumi.Output<string>;
}

export interface PlatformOidc {
  otelOidcIssuer: string;
  otelOidcClientId: string;
  otelOidcClientSecret: pulumi.Output<string> | undefined;
}

export interface CollectorConsumers {
  langfuseEnabled: boolean;
  posthogLogsEnabled: boolean;
  posthogMetricsEnabled: boolean;
  posthogTracesEnabled: boolean;
}

export function loadObservability(
  cfg: pulumi.Config,
  observabilityFlag: boolean,
  { otelOidcIssuer, otelOidcClientId, otelOidcClientSecret }: PlatformOidc,
  { langfuseEnabled, posthogLogsEnabled, posthogMetricsEnabled, posthogTracesEnabled }: CollectorConsumers,
): ObservabilityConfig {
  const collectorEnabled = observabilityFlag && (langfuseEnabled || posthogLogsEnabled || posthogMetricsEnabled || posthogTracesEnabled);
  if (observabilityFlag && !collectorEnabled) {
    pulumi.log.warn(
      "OTel Collector (ADR-0029) not deployed: nothing consumes it. Enable Langfuse " +
        "(it also needs the otelOidc* application) or one of the stack keys " +
        "posthogLogsEnabled, posthogMetricsEnabled and posthogTracesEnabled, or set " +
        "grid-oib:observabilityEnabled=false to silence this.",
    );
  }
      return {
    enabled: collectorEnabled,
    collectorImage:
      cfg.get("collectorImage") ??
      // Digest of the 0.165.0 tag as of 2026-11-14; bumped from 0.163.2 for go-jose and x/net advisories found by trivy.
      "otel/opentelemetry-collector-contrib@sha256:e40d61f10c9a617cca1ffd1be4d7e2b3a4b0f0001798ff07e58cabe82e618cea",
    oidcIssuer: otelOidcIssuer,
    oidcClientId: otelOidcClientId,
    oidcClientSecret: otelOidcClientSecret ?? pulumi.output(""),
  };
}

export const LOG_SHIPPER = {
  name: "otel-logs",
  namespace: "observability",
  podLogDir: "/var/log/pods",
  maxLineBytes: 16 * 1024,
  infoSamplePercent: 10,
  otlpInstrumentedContainers: [
    "agent-worker",
    "aiq-agent",
    "aiq-api",
    "api",
    "bff-jobs",
    "chat",
    "frontend",
    "ingest-worker",
    "purger",
  ],
  ownContainers: ["collector"],
  noisyContainers: [
    "clickhouse",
    "dragonfly",
    "filer",
    "langfuse-web",
    "langfuse-worker",
    "master",
    "pgbouncer",
    "postgres",
    "qdrant",
    "rabbitmq",
    "volume",
  ],
} as const;

export const LOG_SOURCE_ATTRIBUTE = "collector.log.source";
export const LOG_SOURCE = { container: "container", event: "k8s.event" } as const;
