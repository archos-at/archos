import * as pulumi from "@pulumi/pulumi";
import { objectName } from "./names";
import {
  type AgentWorkerConfig,
  type ApiConfig,
  type BackendConfig,
  loadChatTier,
} from "./config/chat-tier";
import { type DnsConfig, loadDns } from "./config/dns";
import { type DragonflyConfig, type RateLimitConfig, loadDragonfly } from "./config/dragonfly";
import { type ImagesConfig, loadImages } from "./config/images";
import { type LangfuseConfig, loadLangfuse, refuseLangfuseV4WriteMode } from "./config/langfuse";
import { type ObservabilityConfig, loadObservability } from "./config/observability";
import { type PostgresConfig, loadPostgres } from "./config/postgres";
import { type BackgroundWorkConfig, loadBackgroundWork } from "./config/background-work";
import { type CmsConfig, loadCms } from "./config/cms";
import { refuseInClusterAppArchive } from "./config/barman-backups";
import { type PosthogConfig, loadPosthog } from "./config/posthog";
import {
  type ChromaMigrationConfig,
  type QdrantConfig,
  loadChromaMigration,
  loadQdrantDashboard,
  loadQdrant,
  refuseRetiredVectorKeys,
} from "./config/qdrant";
import { type McpGatewayConfig, loadMcpGateway } from "./config/mcp-gateway";
import { bool, nodeGroup, num } from "./config/readers";
import { type SeaweedfsConfig, loadSeaweedfs } from "./config/seaweedfs";
import { type FrontendConfig, type WebConfig, loadWebTier } from "./config/web-tier";
import { malwareScanConfig } from "./config/malware-scan";
import { publicSourceFetcherConfig } from "./config/public-source-fetcher";
import { type InboundMailConfig, inboundMailConfig } from "./config/inbound-mail";
import {
  type BffJobsConfig,
  type GotenbergConfig,
  type IngestWorkerConfig,
  type KedaConfig,
  type ProviderLimitsConfig,
  loadWorkers,
} from "./config/workers";
import {
  type AuthConfig,
  type InternalConfig,
  type LlmConfig,
  type SkillsConfig,
  type WebPushConfig,
  loadAppServices,
} from "./config/app-services";
import { type IngressConfig, loadIngress } from "./config/ingress";
export { GOTENBERG_SLOTS_PER_REPLICA, gotenbergCapacity, renditionCeiling } from "./rendition-sizing";

export interface DeployConfig {
  namespace: string;
  kubeconfig: pulumi.Output<string>;

  images: ImagesConfig;

  storage: {
    className: string;
  };

  ingress: IngressConfig;

  dns: DnsConfig;

  inboundMail: InboundMailConfig;

  rateLimit: RateLimitConfig;

  postgres: PostgresConfig;

  backgroundWork: BackgroundWorkConfig;

  dragonfly: DragonflyConfig;

  networkPolicies: boolean;

  protectDataResources: boolean;

  nodeGroups: {
    app?: string;
    data?: string;
    batch?: string;
  };

  gotenberg: GotenbergConfig;

  geocoderUrl: string;

  malwareScan: {
    enabled: boolean;
    image: string;
  };

  publicSourceFetcher: { replicas: number };

  chromaMigration: ChromaMigrationConfig;

  qdrant: QdrantConfig;

  seaweedfs: SeaweedfsConfig;

  backend: BackendConfig;

  api: ApiConfig;

  frontend: FrontendConfig;

  web: WebConfig;

  conversationBus: boolean;
  agentWorker: AgentWorkerConfig;

  ingestWorker: IngestWorkerConfig;

  bffJobs: BffJobsConfig;

  keda: KedaConfig;

  providerLimits: ProviderLimitsConfig;

  llm: LlmConfig;

  auth: AuthConfig;

  posthog: PosthogConfig;

  internal: InternalConfig;

  webPush: WebPushConfig;

  skills: SkillsConfig;

  storageAlerts: {
    enabled: boolean;
    thresholdPercent: number;
    schedule: string;
  };

  vectorReconcile: {
    enabled: boolean;
    schedule: string;
  };

  observability: ObservabilityConfig;

  langfuse: LangfuseConfig;

  cms: CmsConfig;
  mcpGateway: McpGatewayConfig;
}

export function loadConfig(): DeployConfig {
  const cfg = new pulumi.Config();
  refuseLangfuseV4WriteMode(cfg.get("langfuseV4WriteMode"));

  const rejectPlaceholder = (key: string, markers: string[]) => {
    const v = cfg.get(key);
    if (v !== undefined && markers.some((m) => v.includes(m))) {
      throw new Error(
        `grid-oib:${key} is still the template placeholder ("${v}"). Set a real value before deploying.`,
      );
    }
  };
  rejectPlaceholder("storageClass", ["REPLACE_ME"]);
  const baseDomain = cfg.require("baseDomain");
  const appDomain = cfg.get("appDomain") ?? `app.${baseDomain}`;
  const s3Domain = cfg.get("s3Domain") ?? `s3.${baseDomain}`;
  const webDomain = cfg.get("webDomain") ?? baseDomain;
  rejectPlaceholder("baseDomain", ["example.com"]);
  rejectPlaceholder("appDomain", ["example.com"]);
  rejectPlaceholder("s3Domain", ["example.com"]);
  rejectPlaceholder("webDomain", ["example.com"]);
  rejectPlaceholder("workosClientId", ["REPLACE_ME"]);
  rejectPlaceholder("letsEncryptEmail", ["example.com"]);
  rejectPlaceholder("langfuseDomain", ["example.com"]);
  rejectPlaceholder("qdrantDashboardDomain", ["example.com"]);
  rejectPlaceholder("cmsDomain", ["example.com"]);

  const storageAlertThresholdPercent = num(cfg, "storageAlertThresholdPercent", 80);
  if (
    !Number.isFinite(storageAlertThresholdPercent) ||
    storageAlertThresholdPercent <= 0 ||
    storageAlertThresholdPercent > 100
  ) {
    throw new Error(
      `grid-oib:storageAlertThresholdPercent must be a percentage in (0, 100]; got ` +
        `"${storageAlertThresholdPercent}". This is the share of its storage quota at which an ` +
        "organization is warned (ADR-0042); escalation to 90% and 100% is automatic.",
    );
  }

  const chatTier = loadChatTier(cfg);

  const images = loadImages(cfg);

  const webTier = loadWebTier(cfg);

  const seaweedfs = loadSeaweedfs(cfg);

  const postgres = loadPostgres(cfg);
  refuseInClusterAppArchive(cfg, postgres.backups, { stack: pulumi.getStack(), seaweedPublicHost: s3Domain });

  const dragonflyStores = loadDragonfly(cfg);

  refuseRetiredVectorKeys(cfg);

  const appServices = loadAppServices(cfg);

  const otelOidcIssuer = (cfg.get("otelOidcIssuer") ?? "").replace(/\/+$/, "");
  const otelOidcClientId = cfg.get("otelOidcClientId") ?? "";
  const otelOidcClientSecret = cfg.getSecret("otelOidcClientSecret");
  const observabilityFlag = bool(cfg, "observabilityEnabled", true);
  const missingOidcDeps = [
    otelOidcIssuer === "" ? "otelOidcIssuer" : undefined,
    otelOidcClientId === "" ? "otelOidcClientId" : undefined,
    otelOidcClientSecret === undefined ? "otelOidcClientSecret" : undefined,
  ].filter((k): k is string => k !== undefined);

  const langfuse = loadLangfuse(cfg, baseDomain, missingOidcDeps, observabilityFlag);

  const qdrantDashboard = loadQdrantDashboard(cfg, baseDomain, missingOidcDeps);
  const cms = loadCms(cfg, baseDomain, missingOidcDeps);
  const mcpGateway = loadMcpGateway(
    cfg, baseDomain, appServices.auth.workosAuthkitDomain, langfuse.enabled || cms.enabled, cfg.requireSecret("pgAppPassword"),
  );

  const loadBalancerIp = cfg.get("loadBalancerIp");
  const dns = loadDns(cfg, loadBalancerIp, {
    webDomain,
    appDomain,
    s3Domain,
    langfuseDomain: langfuse.enabled ? langfuse.domain : undefined,
    qdrantDashboardDomain: qdrantDashboard.enabled ? qdrantDashboard.domain : undefined,
    cmsDomain: cms.enabled ? cms.domain : undefined,
    mcpGatewayDomain: mcpGateway.enabled ? mcpGateway.domain : undefined,
  });

  const posthog = loadPosthog(cfg, observabilityFlag);

  const malwareScan = malwareScanConfig(cfg);
  const inboundMail = inboundMailConfig(cfg, {
    dns,
    cloudflareApiToken: cfg.getSecret("cloudflareApiToken"),
    malwareScanEnabled: malwareScan.enabled,
  });

  const observability = loadObservability(
    cfg,
    observabilityFlag,
    { otelOidcIssuer, otelOidcClientId, otelOidcClientSecret },
    {
      langfuseEnabled: langfuse.enabled,
      posthogLogsEnabled: posthog.logsEnabled,
      posthogMetricsEnabled: posthog.metricsEnabled,
      posthogTracesEnabled: posthog.tracesEnabled,
    },
  );

  return {
    namespace: cfg.get("namespace") ?? objectName("namespace"),
    kubeconfig: cfg.requireSecret("kubeconfig"),

    images,

    storage: {
      className: cfg.require("storageClass"),
    },

    ingress: loadIngress(cfg, { appDomain, s3Domain, webDomain }, loadBalancerIp),

    inboundMail,

    dns,

    postgres,

    backgroundWork: loadBackgroundWork(cfg),

    ...dragonflyStores,

    networkPolicies: bool(cfg, "networkPolicies", true),

    protectDataResources: bool(cfg, "protectDataResources", true),

    nodeGroups: {
      app: nodeGroup(cfg, "nodeGroupApp"),
      data: nodeGroup(cfg, "nodeGroupData"),
      batch: nodeGroup(cfg, "nodeGroupBatch"),
    },

    malwareScan,
    publicSourceFetcher: publicSourceFetcherConfig(cfg),

    ...loadWorkers(cfg),

    geocoderUrl: loadGeocoderUrl(cfg),

    chromaMigration: loadChromaMigration(cfg),

    qdrant: loadQdrant(cfg, qdrantDashboard),

    seaweedfs,

    ...chatTier,

    ...webTier,

    ...appServices,

    posthog,

    storageAlerts: {
      enabled: bool(cfg, "storageAlertsEnabled", true),
      thresholdPercent: storageAlertThresholdPercent,
      schedule: cfg.get("storageAlertSchedule") ?? "0 * * * *",
    },

    vectorReconcile: {
      enabled: bool(cfg, "vectorReconcileEnabled", true),
      schedule: cfg.get("vectorReconcileSchedule") ?? "0 3 * * 0",
    },

    observability,

    langfuse,

    cms,
    mcpGateway,
  };
}

export const PUBLIC_GEOCODER_URL = "https://photon.komoot.io";

function loadGeocoderUrl(cfg: pulumi.Config): string {
  const url = (cfg.get("geocoderUrl") ?? "").trim();
  if (url !== "" && !/^https?:\/\/[^\s/]+/.test(url)) {
    throw new Error(`${pulumi.getProject()}:geocoderUrl must be an http(s) URL or empty (got "${url}").`);
  }
  return url;
}
