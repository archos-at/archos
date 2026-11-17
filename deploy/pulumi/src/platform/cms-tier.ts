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
  const pull = buildRegistryPullSecret(cfg, provider, CMS.namespace, "cms-registry-pull", [ns]);
  const cms = installCms(cfg, provider, appNamespace, [ns, pg.cluster, deps.bucketInit, ...(pull ? [pull] : [])], pull ? [{ name: PULL_SECRET_NAME }] : []);
  installCmsRoute(cfg, provider, appNamespace, [cms.service, deps.gateway]);
  return { service: cms.service };
}
