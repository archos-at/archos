import * as pulumi from "@pulumi/pulumi";
import { formerHostnames } from "../app/former-domain";
import { hostsOutsideZone, managedHosts } from "../platform/dns";
import { bool, num } from "./readers";

export interface DnsConfig {
  enabled: boolean;
  zoneId: string;
  zoneName: string;
  apiToken: pulumi.Output<string>;
  targetIp: string;
  hosts: string[];
  ttl: number;
  zoneBaseline: boolean;
  dmarc?: string;
  apexRedirectTo?: string;
  formerHosts: string[];
  formerZoneId: string;
  formerZoneBaseline?: { zoneName: string; dmarc?: string };
}

const ZONE_ID = /^[0-9a-f]{32}$/;

export function loadDns(
  cfg: pulumi.Config,
  loadBalancerIp: string | undefined,
  hosts: Parameters<typeof managedHosts>[0],
): DnsConfig {
  const dnsEnabled = bool(cfg, "dnsEnabled", false);
  const dnsZoneId = cfg.get("dnsZoneId") ?? "";
  const dnsZoneName = (cfg.get("dnsZoneName") ?? "").replace(/\.$/, "");
  const cloudflareApiToken = cfg.getSecret("cloudflareApiToken");
  const dnsApexRedirectTo = cfg.get("dnsApexRedirectTo");
  const dnsZoneBaseline = bool(cfg, "dnsZoneBaseline", false);
  const dnsHosts = managedHosts(hosts);
  const { webDomain } = hosts;
  const formerHosts = formerHostnames(
    { formerBaseDomain: cfg.get("formerBaseDomain"), webDomain, appDomain: hosts.appDomain },
    { enabled: hosts.mcpGatewayDomain !== undefined, domain: hosts.mcpGatewayDomain ?? "" },
  );
  const formerZoneName = (cfg.get("formerDnsZoneName") ?? "").replace(/\.$/, "");
  const formerZoneId = cfg.get("formerDnsZoneId") ?? "";
  if (dnsEnabled) {
    const missingDnsDeps = [
      dnsZoneId === "" ? "dnsZoneId" : undefined,
      dnsZoneName === "" ? "dnsZoneName" : undefined,
      cloudflareApiToken === undefined ? "cloudflareApiToken" : undefined,
    ].filter((k): k is string => k !== undefined);
    if (missingDnsDeps.length > 0) {
      throw new Error(
        `grid-oib:dnsEnabled is set but ${missingDnsDeps
          .map((k) => `grid-oib:${k}`)
          .join(", ")} ${missingDnsDeps.length === 1 ? "is" : "are"} missing. DNS is all-or-nothing ` +
          "on purpose: a half-configured zone leaves some hosts managed and the rest silently stale.",
      );
    }
    if (loadBalancerIp === undefined || loadBalancerIp === "") {
      throw new Error(
        "grid-oib:dnsEnabled requires grid-oib:loadBalancerIp. The A records need an address to " +
          "point at, and an unpinned LoadBalancer IP can change under a Gateway re-creation — " +
          "which would leave the records pointing at an address the provider has since reassigned. " +
          "Deploy once without DNS, read the IP (`kubectl -n envoy-gateway-system get svc`), pin " +
          "it, then enable this.",
      );
    }
    for (const [key, id] of [["dnsZoneId", dnsZoneId], ["formerDnsZoneId", formerZoneId]] as const) {
      if (id !== "" && !ZONE_ID.test(id)) {
        throw new Error(
          `${pulumi.getProject()}:${key} is "${id}", which is not a Cloudflare zone id (32 hex digits, on the ` +
            "zone's Overview page, or printed by deploy/pulumi/scripts/check-cloudflare-token.sh).",
        );
      }
    }
    refuseStrayFormerHosts(formerHosts, { dnsZoneName, formerZoneName, formerZoneId });
    if (cfg.get("formerDnsDmarc") !== undefined && !(dnsZoneBaseline && formerZoneName !== "")) {
      throw new Error(
        `${pulumi.getProject()}:formerDnsDmarc keeps the former zone's _dmarc while the baseline stack moves; ` +
          "it needs dnsZoneBaseline and formerDnsZoneName.",
      );
    }
    const shared = formerHosts.filter((host) => dnsHosts.includes(host));
    if (shared.length > 0) {
      throw new Error(
        `${pulumi.getProject()}:formerBaseDomain puts ${shared.join(", ")} on a host this stack still ` +
          "serves. Set it to the domain being left.",
      );
    }
    const strays = hostsOutsideZone(dnsHosts, dnsZoneName);
    if (strays.length > 0) {
      throw new Error(
        `grid-oib:dnsZoneName is "${dnsZoneName}" but ${strays.join(", ")} ` +
          `${strays.length === 1 ? "is" : "are"} not inside it. Cloudflare treats a name outside ` +
          `the zone as RELATIVE and appends the zone to it, so this would create ` +
          `"${strays[0]}.${dnsZoneName}" and report success. Fix baseDomain, or point dnsZoneName ` +
          "at the zone that actually contains these hosts.",
      );
    }
    if (dnsApexRedirectTo !== undefined && webDomain === dnsZoneName) {
      throw new Error(
        `grid-oib:dnsApexRedirectTo is set while this stack already serves the apex ` +
          `("${webDomain}"). Both would write the same record. Unset dnsApexRedirectTo — the ` +
          "redirect exists only for the window before a stack owns the apex.",
      );
    }
    if (dnsApexRedirectTo !== undefined && !dnsZoneBaseline) {
      throw new Error(
        "grid-oib:dnsApexRedirectTo requires grid-oib:dnsZoneBaseline. The apex, www and _dmarc " +
          "are zone-level records with at most one owning stack; the baseline flag is what " +
          "declares this stack to be it.",
      );
    }
    if (dnsApexRedirectTo !== undefined && !/^https?:\/\//.test(dnsApexRedirectTo)) {
      throw new Error(
        `grid-oib:dnsApexRedirectTo must be an absolute URL (got "${dnsApexRedirectTo}"). ` +
          "Cloudflare sends it to the browser as a Location header verbatim.",
      );
    }
    if (webDomain === dnsZoneName && !dnsZoneBaseline) {
      throw new Error(
        `grid-oib:dnsZoneBaseline must be true on the stack that serves the apex ` +
          `("${webDomain}"). The apex, www and _dmarc have one owner, and the apex's server is it — ` +
          "set it here and remove dnsZoneBaseline and dnsApexRedirectTo from the stack that held them.",
      );
    }
  }
  return {
    enabled: dnsEnabled,
    zoneId: dnsZoneId,
    zoneName: dnsZoneName,
    apiToken: cloudflareApiToken ?? pulumi.secret(""),
    targetIp: loadBalancerIp ?? "",
    hosts: dnsHosts,
    ttl: num(cfg, "dnsTtl", 600),
    zoneBaseline: dnsZoneBaseline,
    dmarc: cfg.get("dnsDmarc"),
    apexRedirectTo: dnsApexRedirectTo,
    formerHosts,
    formerZoneId: formerZoneId !== "" ? formerZoneId : dnsZoneId,
    formerZoneBaseline:
      dnsZoneBaseline && formerZoneName !== "" ? { zoneName: formerZoneName, dmarc: cfg.get("formerDnsDmarc") } : undefined,
  };
}

function refuseStrayFormerHosts(
  formerHosts: string[],
  zones: { dnsZoneName: string; formerZoneName: string; formerZoneId: string },
): void {
  const project = pulumi.getProject();
  if ((zones.formerZoneName === "") !== (zones.formerZoneId === "")) {
    throw new Error(
      `${project}:formerDnsZoneName and ${project}:formerDnsZoneId go together: the name checks the ` +
        "former hosts fall inside the zone the id writes them to.",
    );
  }
  const zone = zones.formerZoneName !== "" ? zones.formerZoneName : zones.dnsZoneName;
  const strays = hostsOutsideZone(formerHosts, zone);
  if (strays.length > 0) {
    throw new Error(
      `${project}:formerBaseDomain puts ${strays.join(", ")} outside the zone "${zone}". Set ` +
        `${project}:formerDnsZoneName and ${project}:formerDnsZoneId to the zone that holds the ` +
        "former domain, so its records keep pointing at the Gateway that serves the 301s.",
    );
  }
}
