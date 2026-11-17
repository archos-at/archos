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
