import * as pulumi from "@pulumi/pulumi";

import { loadConfig } from './src/config'
import { backendAutoscaled } from './src/config/chat-tier'
import { backendImage, frontendImage, webImage } from './src/config/images'
import { makeProvider } from "./src/platform/providers";
import { appNamespaces, makeAppNamespace } from "./src/platform/namespaces";
import { installCertManager } from "./src/platform/cert-manager";
import { installGatewayController, installGatewayResources } from "./src/platform/gateway";
import { installMetricsServer } from "./src/platform/metrics-server";
import { installNetworkPolicies } from "./src/platform/network-policies";
import { installPostgres, installScheduledBackup, type Postgres } from "./src/data/postgres";
import { installDragonfly, installLangfuseQueue, installRateLimitStore } from "./src/data/dragonfly";
import { installClickHouse } from "./src/data/clickhouse";
import { installSeaweedFS, type SeaweedFS } from "./src/data/seaweedfs";
import { installSeaweedFSBackup } from "./src/data/seaweedfs-backup";
import { installQdrant } from "./src/data/qdrant";
import { installWorkloadAlerts } from "./src/platform/workload-alerts";
import { AppWiring, PULL_SECRET_NAME, buildRegistryPullSecret, buildSecrets } from "./src/app/config";
import { runMigrations } from "./src/app/migrations-job";
import { buildOnlineIndexes } from "./src/app/online-indexes-job";
import { runKnowledgeCarry } from "./src/app/knowledge-carry-job";
import { reconcileAuditSchemas } from "./src/app/audit-schemas-job";
import { carryOverFolderGrants, reconcileAuthzCatalog } from "./src/app/workos-authz-jobs";
import { installBackend } from "./src/app/backend";
import { installBackendScaling } from "./src/app/backend-scaling";
import { installApi } from "./src/app/api";
import { LEGACY_API_TIER, LEGACY_CHAT_TIER } from "./src/app/tier-names";
import { installFrontend } from "./src/app/frontend";
import { installWeb } from "./src/app/web";
import { installGotenberg } from "./src/app/gotenberg";
import { installCodeRunner, installCodeRunnerScaling } from "./src/app/code-runner";
import { installPublicSourceFetcher } from "./src/app/public-source-fetcher";
import { installClamAV } from "./src/app/clamav";
import { installWorkers, syncBaseCorpusAfterRollout } from "./src/app/workers";
import { installAgentWorker } from "./src/app/agent-worker";
import { installIngestWorker, installIngestWorkerHeavy } from "./src/app/ingest-worker";
import { installHatchetQueueAuth } from "./src/app/hatchet-queue-auth";
import { installBffJobs } from "./src/app/bff-jobs";
import { installBackgroundWorkPostgres } from "./src/data/background-work-pg";
import { installHatchet, installHatchetNamespace } from "./src/platform/hatchet";
import { installHatchetNetworkPolicies } from "./src/platform/hatchet-network-policies";
import { installRabbitmq, installRabbitmqOperator } from "./src/platform/rabbitmq";
import { installBackgroundWorkAlerts } from "./src/platform/background-work-alerts";
import { installKeda } from "./src/platform/keda";
import { installHttpRoutes } from "./src/app/httproutes";
import { installOtelCollector } from "./src/platform/otel-collector";
import { installOtelAgent } from "./src/platform/otel-agent";
import { installLogShipper } from "./src/platform/log-shipper";
import { installDns, managedRecordNames } from "./src/platform/dns";
import { inboundMailOutputs, installInboundMail } from "./src/platform/inbound-mail";
import { installInboundMailZone } from "./src/platform/email-routing";
import { installLangfuse } from "./src/platform/langfuse";
import { installQdrantDashboard } from "./src/platform/qdrant-dashboard";
import { installMcpGateway } from "./src/platform/mcp-gateway";
import { LANGFUSE, QDRANT } from "./src/constants";
import { CMS, cmsImage } from "./src/config/cms";
import { installCmsGatewayCredential, installWebCmsSecret } from "./src/platform/cms";
import { installCmsTier } from "./src/platform/cms-tier";

const cfg = loadConfig();
const provider = makeProvider(cfg);

const ns = makeAppNamespace(cfg, provider);
const namespace = ns.metadata.name;

if (cfg.networkPolicies) {
  installNetworkPolicies(cfg, provider, namespace);
}

const gatewayController = installGatewayController(cfg, provider);
const certManager = installCertManager(cfg, provider, namespace, [gatewayController]);
if (cfg.ingress.installMetricsServer) {
  installMetricsServer(provider);
}

const extraBuckets = [
  ...(cfg.postgres.backups.enabled ? [cfg.postgres.backups.bucket] : []),
  ...(cfg.langfuse.enabled ? [LANGFUSE.bucket] : []),
  QDRANT.snapshotBucket,
  ...(cfg.cms.enabled ? [CMS.bucket] : []),
];
const filerNeedsPostgres =
  cfg.seaweedfs.topology === "split" && cfg.seaweedfs.filerStore === "postgres";

let seaweed: SeaweedFS;
let postgres: Postgres;

if (filerNeedsPostgres) {
  postgres = installPostgres(cfg, provider, namespace, []);
  seaweed = installSeaweedFS(
    cfg,
    provider,
    namespace,
    extraBuckets,
    postgres.rwHost,
    postgres.filerStoreDeps,
  );
} else {
  seaweed = installSeaweedFS(cfg, provider, namespace, extraBuckets);
  postgres = installPostgres(
    cfg,
    provider,
    namespace,
    cfg.postgres.backups.enabled ? [seaweed.bucketInitJob] : [],
  );
}

installScheduledBackup(cfg, provider, namespace, [postgres.cluster, seaweed.bucketInitJob]);

installSeaweedFSBackup(
  cfg,
  provider,
  namespace,
  [seaweed.service, seaweed.bucketInitJob],
  { master: seaweed.masterAddress, filer: seaweed.filerAddress },
);
const dragonfly = installDragonfly(cfg, provider, namespace);

const backgroundWorkNs = installHatchetNamespace(provider);
const backgroundWorkPg = installBackgroundWorkPostgres(cfg, provider, [backgroundWorkNs, postgres.cluster]);
const rabbitmqOperator = installRabbitmqOperator(provider, [certManager.release]);
const rabbitmq = installRabbitmq(cfg, provider, [backgroundWorkNs, rabbitmqOperator]);
installBackgroundWorkAlerts(provider, [backgroundWorkNs]);
const hatchet = installHatchet(cfg, provider, namespace, backgroundWorkPg.ownerDsn, [
  backgroundWorkNs,
  backgroundWorkPg.cluster,
  rabbitmq.cluster,
]);
const hatchetGrants = backgroundWorkPg.grants([hatchet.release]);
if (cfg.networkPolicies) {
  installHatchetNetworkPolicies(cfg, provider, namespace, [backgroundWorkNs]);
}
const clickhouse = cfg.langfuse.enabled
  ? installClickHouse(cfg, provider, namespace, [ns])
  : undefined;
const langfuseQueue = cfg.langfuse.enabled
  ? installLangfuseQueue(cfg, provider, namespace)
  : undefined;
const rateLimitStore = cfg.rateLimit.enabled
  ? installRateLimitStore(cfg, provider, namespace)
  : undefined;
installWorkloadAlerts(provider, namespace);
const qdrant = installQdrant(cfg, provider, namespace, seaweed.internalEndpoint, [seaweed.bucketInitJob]);
const gotenberg = cfg.gotenberg.enabled
  ? installGotenberg(cfg, provider, namespace, [ns])
  : undefined;
const clamav = cfg.malwareScan.enabled
  ? installClamAV(cfg, provider, namespace, [ns])
  : undefined;
const pullSecret = buildRegistryPullSecret(cfg, provider, namespace);
const publicSourceFetcher = installPublicSourceFetcher(cfg, provider, namespace, [ns, ...(pullSecret ? [pullSecret] : [])], pullSecret ? [{ name: PULL_SECRET_NAME }] : []);
const codeRunner = cfg.codeRunner.enabled
  ? installCodeRunner(cfg, provider, namespace, [ns, ...(pullSecret ? [pullSecret] : [])], pullSecret ? [{ name: PULL_SECRET_NAME }] : [])
  : undefined;
const wiring: AppWiring = {
  cfg,
  namespace,
  provider,
  redisUrl: dragonfly.url,
  seaweedInternalEndpoint: seaweed.internalEndpoint,
  seaweedPublicEndpoint: seaweed.publicEndpoint,
  gotenbergUrl: gotenberg?.url,
  malwareScanUrl: clamav?.url,
  codeRunnerUrl: codeRunner?.url,
  qdrantUrl: qdrant.url,
  dsn: postgres.dsn,
  imagePullSecrets: pullSecret ? [{ name: PULL_SECRET_NAME }] : [],
};

const secrets = buildSecrets(wiring);

const onlineIndexes = buildOnlineIndexes(wiring, cfg, secrets, [postgres.cluster, postgres.initJob]);
const migratedSchema = runMigrations(wiring, cfg, secrets, [
  postgres.cluster,
  postgres.initJob,
  postgres.pooler,
  onlineIndexes,
]);
const migrations = postgres.renameRlsRoles([migratedSchema]);

const authzCatalog = cfg.auth.requireAuth ? reconcileAuthzCatalog(wiring, cfg, secrets, [ns]) : undefined;
if (cfg.auth.requireAuth) {
  reconcileAuditSchemas(wiring, cfg, secrets, [ns]);
}

const workers = installWorkers(wiring, cfg, secrets, [migrations]);

const apiDependsOn = [
  hatchet.tokenSync,
  postgres.initJob,
  seaweed.bucketInitJob,
  dragonfly.service,
  qdrant.service,
];
const api = installApi(wiring, cfg, secrets, apiDependsOn);
const legacyApi = installApi(wiring, cfg, secrets, apiDependsOn, LEGACY_API_TIER);

syncBaseCorpusAfterRollout(wiring, cfg, secrets, [migrations, api.deployment, api.service]);

const backendDependsOn = [
  hatchet.tokenSync,
  postgres.initJob,
  postgres.pooler,
  seaweed.bucketInitJob,
  dragonfly.service,
  qdrant.service,
];
const backend = installBackend(wiring, cfg, secrets, backendDependsOn);

const frontend = installFrontend(wiring, cfg, secrets, [
  migrations,
  hatchet.tokenSync,
  api.service,
  legacyApi.service,
  backend.statefulSet,
  backend.service,
]);

if (authzCatalog) {
  carryOverFolderGrants(wiring, cfg, secrets, [migrations, frontend.deployment, authzCatalog]);
}

const legacyBackend = installBackend(
  wiring,
  cfg,
  secrets,
  [...backendDependsOn, frontend.deployment],
  LEGACY_CHAT_TIER,
);

const webCmsSecret = installWebCmsSecret(cfg, provider, cfg.namespace, [ns]);
const web = installWeb(cfg, provider, namespace, wiring.imagePullSecrets, [
  ns,
  ...(pullSecret ? [pullSecret] : []),
  ...(webCmsSecret ? [webCmsSecret] : []),
]);

const keda = cfg.keda.install ? installKeda(provider) : undefined;

if (codeRunner) {
  installCodeRunnerScaling(cfg, provider, namespace, codeRunner, keda ? [keda] : []);
}

const hatchetQueueAuth = installHatchetQueueAuth(wiring, backgroundWorkPg.scalerDsn, [
  ...(keda ? [keda] : []),
  hatchetGrants,
]);
const queueScalerDeps = [...(keda ? [keda] : []), hatchetQueueAuth, hatchetGrants, hatchet.tokenSync];

const agentWorker = installAgentWorker(wiring, cfg, secrets, [
  postgres.initJob,
  postgres.pooler,
  dragonfly.service,
  seaweed.bucketInitJob,
  qdrant.service,
  ...queueScalerDeps,
]);

const ingestWorker = installIngestWorker(wiring, cfg, secrets, [
  postgres.initJob,
  postgres.pooler,
  dragonfly.service,
  seaweed.bucketInitJob,
  qdrant.service,
  ...queueScalerDeps,
]);

installIngestWorkerHeavy(wiring, cfg, secrets, [
  postgres.initJob,
  postgres.pooler,
  dragonfly.service,
  seaweed.bucketInitJob,
  qdrant.service,
  ...queueScalerDeps,
]);

const bffJobs = installBffJobs(wiring, cfg, secrets, [
  migrations,
  api.service,
  legacyApi.service,
  ...queueScalerDeps,
]);

if (cfg.auth.knowledgeCarry) {
  runKnowledgeCarry(wiring, cfg, secrets, [
    migrations,
    api.deployment,
    api.service,
    publicSourceFetcher.deployment,
    publicSourceFetcher.service,
    frontend.deployment,
    bffJobs.deployment,
    ingestWorker.deployment,
  ]);
}

if (backendAutoscaled(cfg)) {
  installBackendScaling(wiring, cfg, backend.statefulSet, keda ? [keda] : []);
}

const gatewayResources = installGatewayResources(cfg, provider, namespace, certManager.issuerName, [
  gatewayController,
  certManager.release,
  certManager.issuer,
]);
const routes = installHttpRoutes(cfg, provider, namespace, [
  gatewayResources.gateway,
  frontend.service,
  seaweed.service,
  web.service,
  ...(rateLimitStore ? [rateLimitStore.service] : []),
]);
const cmsTier = cfg.cms.enabled
  ? installCmsTier(cfg, provider, { appNamespace: ns, postgresOperator: postgres.cluster, bucketInit: seaweed.bucketInitJob, gateway: gatewayResources.gateway })
  : undefined;
if (cfg.qdrant.dashboard.enabled) {
  installQdrantDashboard(cfg, provider, namespace, [gatewayResources.gateway, qdrant.service]);
}

if (cfg.observability.enabled) {
  const langfuse =
    cfg.langfuse.enabled && clickhouse && langfuseQueue && postgres.langfuseDsn
      ? installLangfuse(
          cfg,
          provider,
          namespace,
          {
            databaseUrl: postgres.langfuseDsn,
            clickhouseHttpUrl: clickhouse.httpUrl,
            clickhouseMigrationUrl: clickhouse.migrationUrl,
            redisUrl: langfuseQueue.url,
            s3Endpoint: seaweed.internalEndpoint,
          },
          [
            gatewayResources.gateway,
            clickhouse.service,
            langfuseQueue.service,
            seaweed.bucketInitJob,
            ...postgres.langfuseStoreDeps,
          ],
        )
      : undefined;

  if (cfg.mcpGateway.enabled && (langfuse || cfg.cms.enabled)) {
    const cmsCredential = installCmsGatewayCredential(cfg, provider, namespace, [ns]);
    installMcpGateway(cfg, provider, namespace, [
      gatewayResources.gateway,
      ...(langfuse ? [langfuse.webService, langfuse.secret] : []),
      ...(cmsCredential ? [cmsCredential] : []),
      ...(rateLimitStore ? [rateLimitStore.service] : []), frontend.service, // and with it the admission Secret
    ]);
  }

  const collector = installOtelCollector(
    cfg, provider, namespace,
    [
      ...(langfuse ? [langfuse.webService] : []),
    ],
    {
      langfuseSecretName: langfuse ? langfuse.secret.metadata.name : undefined,
      qdrantMetricsTargets: qdrant.metricsTargets,
      eventNamespaces: appNamespaces(cfg),
      eventNamespaceResources: [ns, backgroundWorkNs, ...(cmsTier ? [cmsTier.namespace] : [])],
    },
  );

  if (cfg.posthog.metricsEnabled) {
    installOtelAgent(cfg, provider, namespace, [collector.service]);
  }
  if (cfg.posthog.logsEnabled) {
    installLogShipper(cfg, provider, appNamespaces(cfg), [collector.service]);
  }
}

const dns = installDns(cfg);

const inboundMail = installInboundMail(cfg, installInboundMailZone(cfg));

export const appUrl = pulumi.interpolate`https://${cfg.ingress.appDomain}`;
export const s3Url = pulumi.interpolate`https://${cfg.ingress.s3Domain}`;
export const webUrl = pulumi.interpolate`https://${cfg.ingress.webDomain}`;
export const appNamespace = namespace;
export const postgresRwHost = postgres.rwHost;
export const backendService = backend.service.metadata.name;
export const apiService = api.service.metadata.name;
export const legacyBackendService = legacyBackend.service.metadata.name;
export const legacyApiService = legacyApi.service.metadata.name;
export const frontendService = frontend.service.metadata.name;
export const webService = web.service.metadata.name;
export const purgerDeployment = workers.purger.metadata.name;
export const appRoute = routes.app.metadata.name;
export const webRoute = routes.web.metadata.name;
export const gatewayName = gatewayResources.gateway.metadata.name;
export const qdrantUrl = qdrant.url;
export const geocoderUrl = cfg.geocoderUrl || "(none: geocoderUrl is empty)";
export const pgInstances = cfg.postgres.instances;
export const pgBackupsEnabled = cfg.postgres.backups.enabled;
export const networkPoliciesEnabled = cfg.networkPolicies;
export const cmsUrl = cfg.cms.enabled ? `https://${cfg.cms.domain}` : "(none: cmsEnabled=false)";
export const langfuseUrl = cfg.langfuse.enabled
  ? pulumi.interpolate`https://${cfg.langfuse.domain}`
  : pulumi.output("(none: langfuse disabled)");
export const platformMcpUrl = cfg.mcpGateway.enabled
  ? pulumi.interpolate`https://${cfg.mcpGateway.domain}/langfuse/mcp`
  : pulumi.output("(none: mcpGatewayEnabled=false)");
export const dnsRecords = dns
  ? pulumi.all(managedRecordNames(dns)).apply((names) => names.join(", "))
  : pulumi.output("(none: dnsEnabled=false — records are maintained by hand)");
export const { inboundMailWorker, inboundMailOperator, inboundMailCloudflare } = inboundMailOutputs(cfg, inboundMail);
export const deployedImages = {
  backend: backendImage(cfg),
  frontend: frontendImage(cfg),
  web: webImage(cfg),
  cms: cmsImage(cfg.images, cfg.cms.imageOverride),
  "code-runner": cfg.codeRunner.image,
};
export const ingestWorkerDeployment = ingestWorker.deployment.metadata.name;
export const bffJobsDeployment = bffJobs.deployment.metadata.name;
export const agentWorkerDeployment = agentWorker.deployment.metadata.name;
