import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

export const POSTHOG_DEFAULT_HOST = "https://eu.i.posthog.com";

export const POSTHOG_DEFAULT_PROJECT_TOKEN = "phc_CVrz2Nt2hoJSmBQ9duYHDbWSjkdyQkQxKs7GHxDvg27X"; // pragma: allowlist secret

export const POSTHOG_DEFAULT_PROJECT_ID = "269895";

function posthogExport(cfg: pulumi.Config, key: string, what: string, missing: string[]): boolean {
  const flag = bool(cfg, key, true);
  if (missing.length === 0) return flag;
  if (flag && cfg.get(key) !== undefined) {
    pulumi.log.warn(
      `PostHog ${what} not exported: missing ` +
        missing.map((k) => (k.includes(" ") ? k : `grid-oib:${k}`)).join(", ") +
        `. Set them to ship ${what} to PostHog, or set grid-oib:${key}=false to silence this.`,
    );
  }
  return false;
}

export interface PosthogConfig {
  host: string;
  projectToken: string;
  logsEnabled: boolean;
  metricsEnabled: boolean;
  tracesEnabled: boolean;
  sessionReplay: boolean;
  replaySampleRate: string;
  releaseId: string;
  personalApiKey: pulumi.Output<string> | undefined;
  projectId: string;
}

export function loadPosthog(cfg: pulumi.Config, observabilityFlag: boolean): PosthogConfig {
  const posthogHost = cfg.get("posthogHost") ?? POSTHOG_DEFAULT_HOST;
  const posthogProjectToken = cfg.get("posthogProjectToken") ?? POSTHOG_DEFAULT_PROJECT_TOKEN;
  const missingPosthogExportDeps = [
    posthogHost === "" ? "posthogHost" : undefined,
    posthogProjectToken === "" ? "posthogProjectToken" : undefined,
    observabilityFlag ? undefined : "observabilityEnabled (the collector is what exports to PostHog)",
  ].filter((k): k is string => k !== undefined);
  const posthogLogsEnabled = posthogExport(cfg, "posthogLogsEnabled", "WARN+ logs", missingPosthogExportDeps);
  const posthogMetricsEnabled = posthogExport(cfg, "posthogMetricsEnabled", "metrics", missingPosthogExportDeps);
  const posthogTracesEnabled = posthogExport(cfg, "posthogTracesEnabled", "request traces", missingPosthogExportDeps);
  return {
    host: posthogHost,
    projectToken: posthogProjectToken,
    logsEnabled: posthogLogsEnabled,
    metricsEnabled: posthogMetricsEnabled,
    tracesEnabled: posthogTracesEnabled,
    sessionReplay: bool(cfg, "posthogSessionReplay", true),
    replaySampleRate: cfg.get("posthogReplaySampleRate") ?? "1",
    releaseId: (cfg.get("posthogReleaseId") ?? "").trim(),
    personalApiKey: cfg.getSecret("posthogPersonalApiKey"),
    projectId: (cfg.get("posthogProjectId") ?? POSTHOG_DEFAULT_PROJECT_ID).trim(),
  };
}
