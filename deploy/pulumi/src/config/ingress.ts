import * as pulumi from "@pulumi/pulumi";
import { bool, num } from "../config/readers";

export interface IngressConfig {
  appDomain: string;
  s3Domain: string;
  webDomain: string;
  webOrigin: string;
  formerBaseDomain?: string;
  letsEncryptEmail: string;
  useStagingIssuer: boolean;
  installMetricsServer: boolean;
  loadBalancerIp?: string;
  xffNumTrustedHops: number;
  maxConnectionsPerProxy: number;
}

export function loadIngress(
  cfg: pulumi.Config,
  { appDomain, s3Domain, webDomain }: { appDomain: string; s3Domain: string; webDomain: string },
  loadBalancerIp: string | undefined,
): IngressConfig {
      return {
    appDomain,
    s3Domain,
    webDomain,
    webOrigin: `https://${webDomain}`,
    formerBaseDomain: cfg.get("formerBaseDomain")?.trim() || undefined,
    letsEncryptEmail: cfg.require("letsEncryptEmail"),
  useStagingIssuer: bool(cfg, "useStagingIssuer", true),
    installMetricsServer: bool(cfg, "installMetricsServer", false),
    loadBalancerIp,
    xffNumTrustedHops: num(cfg, "xffNumTrustedHops", 0),
    maxConnectionsPerProxy: num(cfg, "maxConnectionsPerProxy", 10000),
  };
}
