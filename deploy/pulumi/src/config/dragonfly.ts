import * as pulumi from "@pulumi/pulumi";
import { bool, num } from "./readers";

export interface RateLimitConfig {
  enabled: boolean;
  shadowMode: boolean;
  failClosed: boolean;
  limits: {
    app: number;
    appAuth: number;
    appWsUpgrade: number;
    s3: number;
    web: number;
    webEnquiryPerHour: number;
  };
  storeMaxmemory: string;
  storeMemoryLimit: string;
  storePassword?: pulumi.Output<string>;
}

export interface DragonflyConfig {
  maxmemory: string;
  memoryLimit: string;
  password?: pulumi.Output<string>;
}

export function loadDragonfly(cfg: pulumi.Config): { dragonfly: DragonflyConfig; rateLimit: RateLimitConfig } {
  const rateLimitEnabled = bool(cfg, "rateLimitEnabled", true);
  const allowUnauthenticatedRedis = bool(cfg, "allowUnauthenticatedRedis", false);
  const dragonflyPassword = cfg.getSecret("dragonflyPassword");
  const rateLimitStorePassword = cfg.getSecret("rateLimitStorePassword");
  const missingRedisPasswords = [
    dragonflyPassword === undefined ? "dragonflyPassword" : undefined,
    rateLimitEnabled && rateLimitStorePassword === undefined ? "rateLimitStorePassword" : undefined,
  ].filter((k): k is string => k !== undefined);
  if (missingRedisPasswords.length > 0 && !allowUnauthenticatedRedis) {
    throw new Error(
      `Dragonfly would run with no authentication: ${missingRedisPasswords
        .map((k) => `grid-oib:${k}`)
        .join(", ")} unset. Any pod in the namespace could then read the conversation bus (every ` +
        "chat frame), the cached user directory, authorization decisions and budget state — or reset " +
        "the edge rate-limit counters. Set them:\n" +
        "  pulumi config set --secret grid-oib:dragonflyPassword $(openssl rand -base64 32)\n" +
        "  pulumi config set --secret grid-oib:rateLimitStorePassword $(openssl rand -base64 32)\n" +
        "To deliberately run WITHOUT authentication (dev/single-node only), set:\n" +
        "  pulumi config set grid-oib:allowUnauthenticatedRedis true",
    );
  }
  if (
    dragonflyPassword !== undefined &&
    rateLimitStorePassword !== undefined &&
    cfg.get("dragonflyPassword") === cfg.get("rateLimitStorePassword")
  ) {
    throw new Error(
      "grid-oib:rateLimitStorePassword must differ from grid-oib:dragonflyPassword. Every app pod " +
        "carries the cache password in REDIS_URL; sharing it would let the app tier authenticate to " +
        "the edge counter store and lift its own rate limits.",
    );
  }
  if (allowUnauthenticatedRedis && missingRedisPasswords.length > 0) {
    pulumi.log.warn(
      "Dragonfly is running WITHOUT authentication (allowUnauthenticatedRedis=true): " +
        missingRedisPasswords.map((k) => `grid-oib:${k}`).join(", ") +
        " unset. Any pod in the namespace can read and rewrite the conversation bus, the cached " +
        "user directory, authorization decisions and budget state.",
    );
  }
  return {
    dragonfly: {
      maxmemory: cfg.get("dragonflyMaxmemory") ?? "512mb",
      memoryLimit: cfg.get("dragonflyMemoryLimit") ?? "768Mi",
      password: dragonflyPassword,
    },
    rateLimit: {
      enabled: rateLimitEnabled,
      shadowMode: bool(cfg, "rateLimitShadowMode", true),
      failClosed: bool(cfg, "rateLimitFailClosed", false),
      limits: {
        app: num(cfg, "rateLimitApp", 600),
        appAuth: num(cfg, "rateLimitAppAuth", 20),
        appWsUpgrade: num(cfg, "rateLimitAppWsUpgrade", 30),
        s3: num(cfg, "rateLimitS3", 300),
        web: num(cfg, "rateLimitWeb", 120),
        webEnquiryPerHour: num(cfg, "rateLimitWebEnquiryPerHour", 5),
      },
      storeMaxmemory: cfg.get("rateLimitStoreMaxmemory") ?? "256mb",
      storeMemoryLimit: cfg.get("rateLimitStoreMemoryLimit") ?? "384Mi",
      storePassword: rateLimitStorePassword,
    },
  };
}
