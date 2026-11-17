import type * as k8s from "@pulumi/kubernetes";
import type { DeployConfig } from "../config";
import { sref } from "./config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export function migrationEnv(): EnvVar[] {
  return [sref("APP_MIGRATION_DATABASE_URL")];
}

export function auditSchemaEnv(): EnvVar[] {
  return [sref("WORKOS_API_KEY")];
}

export function authzCatalogEnv(cfg: DeployConfig): EnvVar[] {
  return [
    sref("WORKOS_API_KEY"),
    { name: "PLATFORM_ORG_EXTERNAL_ID", value: cfg.auth.platformOrgExternalId },
  ];
}

export function folderGrantsCarryOverEnv(): EnvVar[] {
  return [sref("WORKOS_API_KEY"), sref("APP_MIGRATION_DATABASE_URL")];
}
