import * as pulumi from "@pulumi/pulumi";
import { bool } from "./readers";

export const LANGFUSE_ORG_ROLES = [
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
  "NONE",
] as const;

export type LangfuseOrgRole = (typeof LANGFUSE_ORG_ROLES)[number];

function langfuseOrgRole(value: string | undefined): LangfuseOrgRole {
  if (value === undefined || value.trim() === "") return "VIEWER";
  const role = LANGFUSE_ORG_ROLES.find((known) => known === value.trim());
  if (role) return role;
  throw new Error(
    `langfuseDefaultRole must be one of ${LANGFUSE_ORG_ROLES.join(", ")}, not "${value}"`,
  );
}

export function refuseLangfuseV4WriteMode(value: string | undefined): void {
  if (value === undefined) return;
  throw new Error(
    `langfuseV4WriteMode was removed: Langfuse writes v4 events only. Drop "${value}" with \`pulumi config rm grid-oib:langfuseV4WriteMode\`.`,
  );
}

export interface LangfuseConfig {
  enabled: boolean;
  domain: string;
  webImage: string;
  workerImage: string;
  clickhouseImage: string;
  v4HistoricBackfill: boolean;
  clickhouseStorageSize: string;
  queueMaxmemory: string;
  queueMemoryLimit: string;
  queuePassword: pulumi.Output<string>;
  databasePassword: pulumi.Output<string>;
  clickhousePassword: pulumi.Output<string>;
  salt: pulumi.Output<string>;
  encryptionKey: pulumi.Output<string>;
  nextAuthSecret: pulumi.Output<string>;
  publicKey: pulumi.Output<string>;
  secretKey: pulumi.Output<string>;
  orgId: string;
  projectId: string;
  defaultRole: LangfuseOrgRole;
  initUserEmail: string;
  initUserPassword: pulumi.Output<string>;
  s3AccessKey: string;
  s3SecretKey: pulumi.Output<string>;
}

export function loadLangfuse(
  cfg: pulumi.Config,
  baseDomain: string,
  missingOidcDeps: string[],
  observabilityFlag: boolean,
): LangfuseConfig {
  const langfuseDomain = cfg.get("langfuseDomain") ?? `langfuse.${baseDomain}`;
  const langfuseFlag = bool(cfg, "langfuseEnabled", true);
  const langfuseEncryptionKey = cfg.getSecret("langfuseEncryptionKey");
  const langfusePublicKey = cfg.getSecret("langfusePublicKey");
  const langfuseSecretKey = cfg.getSecret("langfuseSecretKey");
  const langfuseSecretKeys = [
    "langfuseSalt",
    "langfuseEncryptionKey",
    "langfuseNextAuthSecret",
    "langfusePublicKey",
    "langfuseSecretKey",
    "langfuseDbPassword",
    "langfuseClickhousePassword",
    "langfuseQueuePassword",
    "langfuseS3SecretKey",
    "langfuseInitUserPassword",
  ];
  const missingLangfuseDeps = [
    ...langfuseSecretKeys.filter((key) => (cfg.get(key) ?? "").trim() === ""),
    ...missingOidcDeps,
    observabilityFlag
      ? undefined
      : "observabilityEnabled (Langfuse is fed by the collector)",
  ].filter((k): k is string => k !== undefined);
  const langfuseEnabled = langfuseFlag && missingLangfuseDeps.length === 0;
  if (langfuseFlag && !langfuseEnabled) {
    pulumi.log.warn(
      "Langfuse (ADR-0044) not deployed: missing " +
        missingLangfuseDeps
          .map((k) => (k.includes(" ") ? k : `grid-oib:${k}`))
          .join(", ") +
        ". Set them to deploy the durable trace store, or set " +
        "grid-oib:langfuseEnabled=false to silence this.",
    );
  }
  if (langfuseEnabled) {
    const encryptionKeyRaw = (cfg.get("langfuseEncryptionKey") ?? "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyRaw)) {
      throw new Error(
        "grid-oib:langfuseEncryptionKey must be exactly 64 hex characters (a 256-bit key). " +
          `Got ${encryptionKeyRaw.length} character(s). Note this is the ONE secret here that is ` +
          "hex rather than base64 — generate it with `openssl rand -hex 32`, not `openssl rand -base64 32`.",
      );
    }
    const keyPrefixes: Array<[string, string]> = [
      ["langfusePublicKey", "pk-lf-"],
      ["langfuseSecretKey", "sk-lf-"],
    ];
    for (const [key, prefix] of keyPrefixes) {
      const value = (cfg.get(key) ?? "").trim();
      if (!value.startsWith(prefix)) {
        throw new Error(
          `grid-oib:${key} must start with "${prefix}" — Langfuse validates the prefix on the ` +
            "keys it seeds at headless initialization and refuses to start otherwise. Generate " +
            `one with \`echo "${prefix}$(openssl rand -hex 16)"\`.`,
        );
      }
    }
    const clickhousePasswordRaw = (
      cfg.get("langfuseClickhousePassword") ?? ""
    ).trim();
    if (!/^[A-Za-z0-9._~-]+$/.test(clickhousePasswordRaw)) {
      throw new Error(
        "grid-oib:langfuseClickhousePassword must contain only URL-safe characters " +
          "(A-Z a-z 0-9 . _ ~ -). Langfuse's ClickHouse migrator interpolates it into a " +
          "connection-string query parameter without encoding it, so `+`, `=`, `/` or `&` — " +
          "all of which `openssl rand -base64 32` produces — break the migration and " +
          "crash-loop langfuse-web. Generate this one with `openssl rand -hex 32` instead.",
      );
    }

    if (!bool(cfg, "networkPolicies", true)) {
      throw new Error(
        "grid-oib:langfuseEnabled requires grid-oib:networkPolicies. Langfuse, its ClickHouse " +
          "and its queue hold every tenant's prompts and LLM output in the app namespace, and " +
          "the NetworkPolicy set is what keeps the rest of the namespace off them. Set " +
          "networkPolicies=true, or langfuseEnabled=false.",
      );
    }
    const queuePasswordRaw = (cfg.get("langfuseQueuePassword") ?? "").trim();
    const collides = [
      ["dragonflyPassword", cfg.get("dragonflyPassword")],
      ["rateLimitStorePassword", cfg.get("rateLimitStorePassword")],
    ].find(([, other]) => (other ?? "").trim() === queuePasswordRaw);
    if (collides) {
      throw new Error(
        `grid-oib:langfuseQueuePassword must differ from grid-oib:${collides[0]}. They are ` +
          "separate Redis-protocol instances precisely so that holding one credential does not " +
          "confer control of the others; an identical value silently removes that separation.",
      );
    }
    const langfuseS3SecretRaw = (cfg.get("langfuseS3SecretKey") ?? "").trim();
    const s3Collides = [
      ["seaweedfsSecretKey", cfg.get("seaweedfsSecretKey")],
      [
        "seaweedfsBackendReadSecretKey",
        cfg.get("seaweedfsBackendReadSecretKey"),
      ],
      [
        "seaweedfsTenantAdminSecretKey",
        cfg.get("seaweedfsTenantAdminSecretKey"),
      ],
    ].find(([, other]) => (other ?? "").trim() === langfuseS3SecretRaw);
    if (s3Collides) {
      throw new Error(
        `grid-oib:langfuseS3SecretKey must differ from grid-oib:${s3Collides[0]}. SeaweedFS ` +
          "authenticates by key, so a shared secret gives the Langfuse tier that identity's " +
          "bucket scope instead of its own single-bucket one.",
      );
    }
  }
  return {
    enabled: langfuseEnabled,
    domain: langfuseDomain,
    webImage:
      cfg.get("langfuseWebImage") ??
      // Digest read from the registry on 2026-11-03; 26.8 is a moving tag upstream, so the pin stays until a trivy-clean bump.
      "ghcr.io/langfuse/langfuse@sha256:0814758db3db8e923f733be3884e7d7a9e3afd60568d874a610d78aae47476c5",
    workerImage:
      cfg.get("langfuseWorkerImage") ??
      "ghcr.io/langfuse/langfuse-worker@sha256:da9f618dd784219aa6508ab6941c4a89c4ef6fb429fb1734c4163df3baa8f1ca",
    clickhouseImage:
      cfg.get("clickhouseImage") ??
      "clickhouse/clickhouse-server@sha256:1c0b76ac42e16b4eeb0be84013c67269b660701971d29bab9ad0d01b0ba6c10d",
    v4HistoricBackfill: bool(cfg, "langfuseV4HistoricBackfill", false),
    clickhouseStorageSize: cfg.get("clickhouseStorageSize") ?? "50Gi",
    queueMaxmemory: cfg.get("langfuseQueueMaxmemory") ?? "512mb",
    queueMemoryLimit: cfg.get("langfuseQueueMemoryLimit") ?? "1Gi",
    queuePassword: cfg.getSecret("langfuseQueuePassword") ?? pulumi.output(""),
    databasePassword: cfg.getSecret("langfuseDbPassword") ?? pulumi.output(""),
    clickhousePassword:
      cfg.getSecret("langfuseClickhousePassword") ?? pulumi.output(""),
    salt: cfg.getSecret("langfuseSalt") ?? pulumi.output(""),
    encryptionKey: langfuseEncryptionKey ?? pulumi.output(""),
    nextAuthSecret:
      cfg.getSecret("langfuseNextAuthSecret") ?? pulumi.output(""),
    publicKey: langfusePublicKey ?? pulumi.output(""),
    secretKey: langfuseSecretKey ?? pulumi.output(""),
    orgId: cfg.get("langfuseOrgId") ?? "grid",
    projectId: cfg.get("langfuseProjectId") ?? "grid-oib",
    defaultRole: langfuseOrgRole(cfg.get("langfuseDefaultRole")),
    initUserEmail:
      cfg.get("langfuseInitUserEmail") ?? cfg.get("letsEncryptEmail") ?? "",
    initUserPassword:
      cfg.getSecret("langfuseInitUserPassword") ?? pulumi.output(""),
    s3AccessKey: cfg.get("langfuseS3AccessKey") ?? "grid-langfuse",
    s3SecretKey: cfg.getSecret("langfuseS3SecretKey") ?? pulumi.output(""),
  };
}
