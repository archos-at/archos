/**
 * The website's CMS (ADR-0155): Directus in its own namespace, on its own
 * CloudNativePG cluster, with its files in a SeaweedFS bucket of its own.
 *
 * Off unless `cmsEnabled`, and then deployed only with `cmsLicenseKey` set: a
 * Directus without a license runs its core tier, which refuses every
 * permission with a filter or a field list, and the review step (an editor or
 * an agent drafts, a person publishes) is made of exactly those. Without the
 * key the config Job would fail on the first permission it pushes, so the plan
 * warns and deploys nothing instead.
 *
 * Every credential but the license defaults to a one-way HMAC of
 * `pgAppPassword` under its own label (like `config/background-work.ts`), so
 * turning the CMS on needs no new secret beyond the key. Set a key to rotate
 * its credential on its own.
 */
import * as pulumi from "@pulumi/pulumi";
import { type BarmanBackups, loadBarmanBackups } from "./barman-backups";
import { derivedScalerPassword } from "./postgres";
import { bool, positiveInt } from "./readers";

/** Fixed names the namespace, the cluster, the Service, the Job and the policies agree on. */
export const CMS = {
  namespace: "cms",
  app: "directus",
  cluster: "cms-pg",
  database: "directus",
  owner: "directus",
  bucket: "cms-files",
  s3Identity: "cms",
  port: 8055,
  /** `node`, the user both images run as (Directus' and `node:26-alpine`). */
  uid: 1000,
  /** Gateway listener and HTTPRoute for the Studio, the API and `/mcp`. */
  listenerName: "https-cms",
  routeName: "cms",
  tlsSecret: "cms-tls",
  /** `max_connections` of `cms-pg`; Directus pools at `DB_POOL__MAX` per pod. */
  maxConnections: 50,
  poolMax: 10,
} as const;

/** Directus 12.6.1 (2026-11-04), the multi-arch index digest of Docker Hub's `12.6.1` tag, read 2026-11-05. */
export const CMS_IMAGE =
  "directus/directus:12.6.1@sha256:e1561b5e526e8e7a2ac19b7bb6eab63611dd84a862a8c45b864118768a2baff4";
/** The config Job's runtime: Node with npm, for `@directus/cli`. `node:26-alpine`, read 2026-11-05. */
export const CMS_SYNC_IMAGE =
  "node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94";
/** `@directus/cli` (`d6s`): the newest 12.x on npm on 2026-11-05. The sync files carry the server version they were pulled from. */
export const CMS_CLI_VERSION = "12.5.0";

export interface CmsConfig {
  /** `cmsEnabled` AND `cmsLicenseKey` set AND network policies on. */
  enabled: boolean;
  /** `cms.<baseDomain>` unless `cmsDomain`. */
  domain: string;
  image: string;
  syncImage: string;
  cliVersion: string;
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  /** The license key (Open Innovation Grant or paid), `LICENSE_KEY`. */
  licenseKey: pulumi.Output<string>;
  /** `SECRET`: signs Directus' session and access tokens. */
  secret: pulumi.Output<string>;
  /** The first administrator, created on the first boot only. */
  adminEmail: string;
  adminPassword: pulumi.Output<string>;
  /** The administrator's static token: the config Job pushes the sync files with it. */
  adminToken: pulumi.Output<string>;
  /** Static tokens of the robot users `apps/cms/scripts/provision.mjs` keeps. */
  websiteToken: pulumi.Output<string>;
  socialHandoffToken: pulumi.Output<string>;
  /** The bearer the website's revalidate endpoint accepts from the `Refresh the website` flow. */
  revalidateToken: pulumi.Output<string>;
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
  const licenseKey = cfg.getSecret("cmsLicenseKey");
  const policies = bool(cfg, "networkPolicies", true);
  const key = (name: string) => `${pulumi.getProject()}:${name}`;
  const missing = [
    licenseKey === undefined ? `${key("cmsLicenseKey")} (the core tier refuses the review permissions)` : undefined,
    policies ? undefined : `${key("networkPolicies")} (the CMS's database and API are reachable only through them)`,
  ].filter((m): m is string => m !== undefined);
  if (flag && missing.length > 0) {
    pulumi.log.warn(`The CMS (ADR-0155) is not deployed: missing ${missing.join(", ")}. Set it, or cmsEnabled=false.`);
  }
  const app = cfg.requireSecret("pgAppPassword");
  const derived = (label: string, key: string) => cfg.getSecret(key) ?? derivedScalerPassword(app, `cms-${label}`);
  const cpu = cfg.get("cmsCpu") ?? "1";
  const memory = cfg.get("cmsMemory") ?? "1Gi";
  return {
    enabled: flag && missing.length === 0,
    domain: cfg.get("cmsDomain") ?? `cms.${baseDomain}`,
    image: cfg.get("cmsImage") ?? CMS_IMAGE,
    syncImage: CMS_SYNC_IMAGE,
    cliVersion: CMS_CLI_VERSION,
    resources: { requests: { cpu: "250m", memory }, limits: { cpu, memory } },
    licenseKey: licenseKey ?? pulumi.output(""),
    secret: derived("secret", "cmsSecret"),
    adminEmail: cfg.get("cmsAdminEmail") ?? cfg.require("letsEncryptEmail"),
    adminPassword: derived("admin-password", "cmsAdminPassword"),
    adminToken: derived("admin-token", "cmsAdminToken"),
    websiteToken: derived("website-token", "cmsWebsiteToken"),
    socialHandoffToken: derived("social-handoff-token", "cmsSocialHandoffToken"),
    revalidateToken: derived("revalidate-token", "cmsRevalidateToken"),
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
        holds: "the website's posts, their revisions and the CMS users",
      }),
    },
  };
}
