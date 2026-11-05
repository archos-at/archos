/**
 * The CMS tier (ADR-0155) in the order it comes up: its namespace and
 * policies, its Postgres, Directus, its route, then the config Job that pushes
 * the schema and roles into it. Only called when `cfg.cms.enabled`; the
 * website's side, the `web-cms` Secret, is `installWebCmsSecret` (`cms.ts`).
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { DeployConfig } from "../config";
import { installCmsPostgres } from "../data/cms-pg";
import { installCms, installCmsNamespace, installCmsNetworkPolicies, installCmsRoute } from "./cms";
import { installCmsConfigJob } from "./cms-config-job";

export interface CmsTier {
  service: k8s.core.v1.Service;
  configJob: k8s.batch.v1.Job;
}

export function installCmsTier(
  cfg: DeployConfig,
  provider: k8s.Provider,
  deps: { appNamespace: pulumi.Resource; postgresOperator: pulumi.Resource; bucketInit: pulumi.Resource; gateway: pulumi.Resource },
): CmsTier {
  const appNamespace = cfg.namespace;
  const ns = installCmsNamespace(provider);
  installCmsNetworkPolicies(provider, appNamespace, [ns, deps.appNamespace]);
  const pg = installCmsPostgres(cfg, provider, [ns, deps.postgresOperator]);
  const cms = installCms(cfg, provider, appNamespace, [ns, pg.cluster, deps.bucketInit]);
  installCmsRoute(cfg, provider, appNamespace, [cms.service, deps.gateway]);
  const configJob = installCmsConfigJob(cfg, provider, [cms.deployment, cms.service]);
  return { service: cms.service, configJob };
}
