/**
 * The CMS tier (ADR-0155) in the order it comes up: its namespace and
 * policies, its Postgres, the CMS (which migrates its own schema and provisions
 * its robots on start), its route. Only called when `cfg.cms.enabled`; the
 * website's side, the `web-cms` Secret, is `installWebCmsSecret` (`cms.ts`).
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { buildRegistryPullSecret, PULL_SECRET_NAME } from "../app/config";
import { CMS } from "../config/cms";
import { installCmsPostgres } from "../data/cms-pg";
import { installCms, installCmsNamespace, installCmsNetworkPolicies, installCmsRoute } from "./cms";

export interface CmsTier {
  service: k8s.core.v1.Service;
}

export function installCmsTier(
  cfg: DeployConfig,
  provider: k8s.Provider,
  deps: { appNamespace: pulumi.Resource; postgresOperator: pulumi.Resource; bucketInit: pulumi.Resource; gateway: pulumi.Resource },
): CmsTier {
  const appNamespace = cfg.namespace;
  const ns = installCmsNamespace(provider);
  installCmsNetworkPolicies(cfg, provider, appNamespace, [ns, deps.appNamespace]);
  const pg = installCmsPostgres(cfg, provider, [ns, deps.postgresOperator]);
  // The CMS image is as private as the app's, and a pull Secret is namespaced: the
  // CMS's namespace gets its own copy, or the pod meets GHCR's 401 and never starts.
  const pull = buildRegistryPullSecret(cfg, provider, CMS.namespace, "cms-registry-pull", [ns]);
  const cms = installCms(cfg, provider, appNamespace, [ns, pg.cluster, deps.bucketInit, ...(pull ? [pull] : [])], pull ? [{ name: PULL_SECRET_NAME }] : []);
  installCmsRoute(cfg, provider, appNamespace, [cms.service, deps.gateway]);
  return { service: cms.service };
}
