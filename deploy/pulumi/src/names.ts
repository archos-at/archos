import * as pulumi from "@pulumi/pulumi";

export const LEGACY_PROJECT = "grid-oib";
export const PROJECT = "workspace";

export function isLegacyProject(project: string = pulumi.getProject()): boolean {
  return project !== PROJECT;
}

const TABLE = {
  namespace: ["grid", "workspace"],
  partOf: ["grid-oib", "workspace"],
  secretChecksumAnnotation: ["grid.bigls.net/secret-checksum", "checksum/secrets"],

  appSecret: ["grid-secrets", "app-secrets"],
  registryPullSecret: ["grid-registry-pull", "registry-pull"],
  kedaScalerSecret: ["grid-keda-scaler", "keda-scaler"],
  rateLimitRedisAuthSecret: ["grid-ratelimit-redis-auth", "ratelimit-redis-auth"],

  pgCluster: ["grid-pg", "postgres"],
  pgPoolerRw: ["grid-pg-pooler-rw", "postgres-pooler-rw"],
  pgBackupSecret: ["grid-pg-backup-s3", "postgres-backup-s3"],
  pgScheduledBackup: ["grid-pg-nightly", "postgres-nightly"],

  gatewayClass: ["eg", "workspace-edge"],
  gateway: ["grid-gateway", "edge"],
  envoyProxy: ["grid-envoy-proxy", "edge-proxy"],
  wsTimeouts: ["grid-ws-timeouts", "ws-timeouts"],

  appRoute: ["grid-app", "app"],
  appTimeouts: ["grid-app-timeouts", "app-timeouts"],
  appTls: ["grid-app-tls", "app-tls"],
  s3Route: ["grid-s3", "s3"],
  s3Timeouts: ["grid-s3-timeouts", "s3-timeouts"],
  s3Tls: ["grid-s3-tls", "s3-tls"],
  webRoute: ["grid-web", "web"],
  webTimeouts: ["grid-web-timeouts", "web-timeouts"],
  webTls: ["grid-web-tls", "web-tls"],
  httpsRedirectRoute: ["grid-https-redirect", "https-redirect"],
  langfuseRoute: ["grid-langfuse", "langfuse"],
  langfuseTls: ["grid-langfuse-tls", "langfuse-tls"],
  langfuseAuth: ["grid-langfuse-auth", "langfuse-auth"],
  qdrantDashboardRoute: ["grid-qdrant-dashboard", "qdrant-dashboard"],
  qdrantDashboardAuth: ["grid-qdrant-dashboard-auth", "qdrant-dashboard-auth"],
  qdrantTls: ["grid-qdrant-tls", "qdrant-tls"],
  formerWebTls: ["grid-former-web-tls", "former-web-tls"],
  formerAppTls: ["grid-former-app-tls", "former-app-tls"],
  formerWebRedirectRoute: ["grid-former-web-redirect", "former-web-redirect"],
  formerAppRedirectRoute: ["grid-former-app-redirect", "former-app-redirect"],
  formerAppTimeouts: ["grid-former-app-timeouts", "former-app-timeouts"],
  formerPlatformMcpTls: ["grid-former-platform-mcp-tls", "former-platform-mcp-tls"],

  migrateJob: ["grid-app-migrate", "app-migrate"],
  auditSchemasJob: ["grid-app-audit-schemas", "app-audit-schemas"],
  authzCatalogJob: ["grid-app-authz-catalog", "app-authz-catalog"],
  folderGrantsJob: ["grid-app-folder-grants", "app-folder-grants"],
  chromaMigrationJob: ["grid-chroma-migration", "chroma-migration"],
} as const satisfies Record<string, readonly [string, string]>;

export type NameKey = keyof typeof TABLE;

export function objectName(key: NameKey, project?: string): string {
  return TABLE[key][isLegacyProject(project) ? 0 : 1];
}

export function brandFreeNames(): Record<NameKey, string> {
  return Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v[1]])) as Record<NameKey, string>;
}

export function logicalName(legacy: string, project?: string): string {
  return isLegacyProject(project) ? legacy : legacy.replace(/^grid-/, "");
}
