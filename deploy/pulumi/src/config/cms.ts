/**
 * The website's CMS (ADR-0155): Payload, our own image `cms` built from
 * apps/cms like the other apps, in its own namespace, on its own CloudNativePG
 * cluster, with its files in a SeaweedFS bucket of its own.
 *
 * Off unless `cmsEnabled`, and then deployed only with network policies on: the
 * CMS's database and its API are reachable only through them. Every credential
 * defaults to a one-way HMAC of `pgAppPassword` under its own label (like
 * `config/background-work.ts`), so turning the CMS on needs no new secret. Set a
 * key to rotate its credential on its own.
 */
import * as pulumi from "@pulumi/pulumi";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
import { type ImagesConfig } from "./images";
import { derivedScalerPassword } from "./postgres";
import { bool, positiveInt } from "./readers";

/** Fixed names the namespace, the cluster, the Service and the policies agree on. */
export const CMS = {
  namespace: "cms",
  app: "cms",
  cluster: "cms-pg",
  database: "cms",
  owner: "cms",
  bucket: "cms-files",
  s3Identity: "cms",
  /** `next start` in apps/cms/Dockerfile. */
  port: 3000,
  /** `nextjs`, the user apps/cms/Dockerfile runs as. */
  uid: 1001,
  /** Gateway listener and HTTPRoute for the admin panel, the REST API and `/api/mcp`. */
  listenerName: "https-cms",
  routeName: "cms",
  tlsSecret: "cms-tls",
  /** `max_connections` of `cms-pg`; Payload pools at `DATABASE_POOL_MAX` per pod. */
  maxConnections: 50,
  poolMax: 10,
} as const;

/** The CMS image: `cmsImage` when set, else the commit's own build, like the other app images. */
export function cmsImage(images: ImagesConfig, override: string | undefined): string {
  return override ?? `${images.registry}/cms:${images.tag}`;
}

export interface CmsConfig {
  /** `cmsEnabled` AND network policies on. */
  enabled: boolean;
  /** `cms.<baseDomain>` unless `cmsDomain`. */
  domain: string;
  /** A full image reference that replaces the commit's `cms` image (a rollback, a hotfix). */
  imageOverride?: string;
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  /** `PAYLOAD_SECRET`: signs sessions and encrypts API keys at rest. */
  secret: pulumi.Output<string>;
  /** The first administrator, created only while the CMS has none. */
  adminEmail: string;
  adminPassword: pulumi.Output<string>;
  /** The API keys of the two robots `apps/cms/src/provision.ts` keeps. */
  websiteApiKey: pulumi.Output<string>;
  socialHandoffApiKey: pulumi.Output<string>;
  /** The bearer the website's revalidate endpoint accepts from the CMS. */
  revalidateToken: pulumi.Output<string>;
  /** Signs the live-preview links the admin panel frames (`apps/cms/src/preview.ts`). */
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

export function loadCms(cfg: pulumi.Config, baseDomain: string): CmsConfig {
  const flag = bool(cfg, "cmsEnabled", false);
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
