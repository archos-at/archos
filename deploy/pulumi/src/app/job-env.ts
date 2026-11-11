/**
 * The environments of the one-shot Jobs a deploy runs (migrations, the WorkOS
 * audit schemas and authorization catalog, the folder-grants carry-over): each
 * names only the secrets its script reads. Split from `config.ts`, whose
 * long-running tiers share far more.
 */

import type * as k8s from "@pulumi/kubernetes";
import type { DeployConfig } from "../config";
import { sref } from "./config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/** Minimal env for the drizzle migration Job. */
export function migrationEnv(): EnvVar[] {
  // drizzle.config.ts prefers this over APP_DATABASE_URL: DDL needs the
  // schema owner, and a backfill run as the RLS-bound runtime role would
  // silently update zero rows (ADR-0041).
  return [sref("APP_MIGRATION_DATABASE_URL")];
}

/**
 * Minimal env for the WorkOS audit-schema reconciliation Job. The API key alone
 * — the script talks to nothing else, and the environment it provisions is the
 * one that key belongs to.
 */
export function auditSchemaEnv(): EnvVar[] {
  return [sref("WORKOS_API_KEY")];
}

/**
 * Env for the WorkOS authorization-catalog Job: the API key, and the external
 * id of the platform organization whose org-scoped roles the catalog also
 * provisions (the frontend reads the same value).
 */
export function authzCatalogEnv(cfg: DeployConfig): EnvVar[] {
  return [
    sref("WORKOS_API_KEY"),
    { name: "PLATFORM_ORG_EXTERNAL_ID", value: cfg.auth.platformOrgExternalId },
  ];
}

/**
 * Env for the folder-grants carry-over Job (ADR-0097): the WorkOS key, and the
 * schema owner's connection, because it reads `project_folder_grants` across
 * every organization and the RLS-bound runtime role would see none of it.
 */
export function folderGrantsCarryOverEnv(): EnvVar[] {
  return [sref("WORKOS_API_KEY"), sref("APP_MIGRATION_DATABASE_URL")];
}
