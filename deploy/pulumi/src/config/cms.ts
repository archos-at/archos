import * as pulumi from "@pulumi/pulumi";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
import { type ImagesConfig } from "./images";
import { derivedScalerPassword } from "./postgres";
import { bool, positiveInt } from "./readers";

export const CMS = {
  namespace: "cms",
  app: "cms",
  cluster: "cms-pg",
  database: "cms",
  owner: "cms",
  bucket: "cms-files",
  s3Identity: "cms",
  port: 3000,
  uid: 1001,
  listenerName: "https-cms",
  routeName: "cms",
  mediaRouteName: "cms-media",
  tlsSecret: "cms-tls",
  maxConnections: 50,
  poolMax: 10,
} as const;

export function cmsImage(images: ImagesConfig, override: string | undefined): string {
  return override ?? `${images.registry}/cms:${images.tag}`;
}

export interface CmsConfig {
  enabled: boolean;
  domain: string;
  imageOverride?: string;
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  secret: pulumi.Output<string>;
  adminEmail: string;
  adminPassword: pulumi.Output<string>;
  websiteApiKey: pulumi.Output<string>;
  socialHandoffApiKey: pulumi.Output<string>;
  platformMcpApiKey: pulumi.Output<string>;
  revalidateToken: pulumi.Output<string>;
  previewSecret: pulumi.Output<string>;
  s3AccessKey: string;
  s3SecretKey: pulumi.Output<string>;
  postgres: {
    instances: number;
    storageSize: string;
    password: pulumi.Output<string>;
    backups: BarmanBackups;
  };
}

export function loadCms(cfg: pulumi.Config, baseDomain: string, missingOidcDeps: string[] = []): CmsConfig {
  const flag = bool(cfg, "cmsEnabled", false);
  if (flag && missingOidcDeps.length > 0) {
    throw new Error(
      `${pulumi.getProject()}:cmsEnabled needs the platform WorkOS Connect application its host is gated by: missing ` +
        `${missingOidcDeps.map((k) => `${pulumi.getProject()}:${k}`).join(", ")} (docs/deployment/kubernetes.md §9).`,
    );
  }
  const policies = bool(cfg, "networkPolicies", true);
  if (flag && !policies) {
    pulumi.log.warn(
      `The CMS (ADR-0155) is not deployed: ${pulumi.getProject()}:networkPolicies is off, and the CMS's database and API are reachable only through them. Turn them on, or cmsEnabled=false.`,
    );
  }
  const app = cfg.requireSecret("pgAppPassword");
  const derived = (label: string, key: string) => cfg.getSecret(key) ?? derivedScalerPassword(app, `cms-${label}`);
  const cpu = cfg.get("cmsCpu") ?? "1";
  const memory = cfg.get("cmsMemory") ?? "1Gi";
  return {
    enabled: flag && policies,
    domain: cfg.get("cmsDomain") ?? `cms.${baseDomain}`,
    imageOverride: cfg.get("cmsImage"),
    resources: { requests: { cpu: "250m", memory }, limits: { cpu, memory } },
    secret: derived("secret", "cmsSecret"),
    adminEmail: cfg.get("cmsAdminEmail") ?? cfg.require("letsEncryptEmail"),
    adminPassword: derived("admin-password", "cmsAdminPassword"),
    websiteApiKey: derived("website-api-key", "cmsWebsiteApiKey"),
    socialHandoffApiKey: derived("social-handoff-api-key", "cmsSocialHandoffApiKey"),
    platformMcpApiKey: derived("platform-mcp-api-key", "cmsPlatformMcpApiKey"),
    revalidateToken: derived("revalidate-token", "cmsRevalidateToken"),
    previewSecret: derived("preview-secret", "cmsPreviewSecret"),
    s3AccessKey: CMS.s3Identity,
    s3SecretKey: derived("s3", "cmsS3SecretKey"),
    postgres: {
      instances: positiveInt(cfg, "cmsPgInstances", 1),
      storageSize: cfg.get("cmsPgStorageSize") ?? "5Gi",
      password: derived("pg", "cmsPgPassword"),
      backups: loadBarmanBackups(cfg, {
        prefix: "cmsPg",
        bucket: "cms-pg-backups",
        retention: "30d",
        schedule: "0 15 2 * * *",
        holds: "the website's posts, their versions and the CMS users",
      }),
    },
  };
}
