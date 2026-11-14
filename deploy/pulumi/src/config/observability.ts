/**
 * The OTel collector (ADR-0029): deployed when something consumes what it forwards.
 */
import * as pulumi from "@pulumi/pulumi";

export interface ObservabilityConfig {
  /**
   * Whether the OTel Collector is deployed: the `observabilityEnabled` flag
   * AND at least one consumer for it (Langfuse or PostHog logs).
   * The collector forwards to those on their own credentials. When false
   * nothing is provisioned and no producer gets an OTLP endpoint.
   */
  enabled: boolean;
  /**
   * OpenTelemetry Collector image reference, digest-pinned by default —
   * the single OTLP ingestion point that fans out to Langfuse and the log
   * consumers (ADR-0029 amendment).
   */
  collectorImage: string;
  /**
   * Issuer of the dedicated WorkOS **Connect** application, i.e. the
   * environment's AuthKit domain (`https://<tenant>.authkit.app`). Its
   * `/oauth2/*` endpoints are a spec-complete OIDC provider; the app's own
   * `/user_management/*` endpoints are not, and cannot serve this flow at all
   * (see the capability check in `loadConfig`).
   *
   * Required for Langfuse (its route is gated by this application and its UI
   * signs in against it). The keys keep their `otelOidc*` names from when the
   * Aspire dashboard shared the application. As a side benefit Langfuse no
   * longer shares the app's AuthKit client, so an ordinary app sign-in does
   * not mint a platform credential, access is separately revocable, and the
   * client secret is purpose-scoped instead of being the WorkOS management
   * API key.
   */
  oidcIssuer: string;
  /** Client id of that Connect application. */
  oidcClientId: string;
  /** Its client secret — the application must be a confidential client. */
  oidcClientSecret: pulumi.Output<string>;
}

/** The platform WorkOS Connect application the collector's edge routes are gated by. */
export interface PlatformOidc {
  otelOidcIssuer: string;
  otelOidcClientId: string;
  otelOidcClientSecret: pulumi.Output<string> | undefined;
}

/** What the collector forwards to; any one of them is reason enough to deploy it. */
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
  // ── The collector: deployed when something consumes what it forwards ──────
  // Four consumers, any of which is enough: Langfuse (LLM traces), PostHog
  // logs, PostHog metrics and PostHog request traces. With none it would receive OTLP from every producer
  // and forward it nowhere, and each producer would carry an endpoint pointing
  // at a pod that does nothing.
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
    // Digest-pinned (supply chain): 0.163.2, the multi-arch index Docker Hub's
    // `0.163.2` tag resolved to on 2026-10-22. Bump deliberately via config when
    // upgrading — the pin is scanned by the trivy job in
    // .github/workflows/security.yml, which blocks on fixable HIGH/CRITICAL, so
    // a stale pin surfaces as a failing check. Moved off 0.161.0 because its
    // go1.26.8 standard library and golang.org/x/net v0.58.0 carried four HIGH
    // advisories (CVE-2026-78667, -78669, -97031, -111943); the 0.163.2 amd64
    // binary, read with `go version -m`, is go1.26.10 with x/net v0.61.0. The
    // otelcol-contrib build in ci.yml (`OTELCOL_VERSION`) moves with this pin.
    // 0.163.2 -> 0.165.0 on 2026-11-14: the promotion's trivy found go-jose v4.1.5
    // (CVE-2026-116587) and x/net v0.61.0 (CVE-2026-78661); the 0.165.0 binary, read
    // with `go version -m`, is go1.27.3 with go-jose v4.1.6 and x/net v0.62.0.
    collectorImage:
      cfg.get("collectorImage") ??
      "otel/opentelemetry-collector-contrib@sha256:e40d61f10c9a617cca1ffd1be4d7e2b3a4b0f0001798ff07e58cabe82e618cea",
    oidcIssuer: otelOidcIssuer,
    oidcClientId: otelOidcClientId,
    oidcClientSecret: otelOidcClientSecret ?? pulumi.output(""),
  };
}
