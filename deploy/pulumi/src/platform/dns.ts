import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from '../config'

export const TTL_AUTOMATIC = 1;

export const UNROUTABLE_PLACEHOLDER = "192.0.2.1";

export interface ManagedDns {
  provider: cloudflare.Provider;
  hostRecords: cloudflare.DnsRecord[];
  formerHostRecords: cloudflare.DnsRecord[];
  baselineRecords: cloudflare.DnsRecord[];
  apexRedirect?: { placeholder: cloudflare.DnsRecord; ruleset: cloudflare.Ruleset };
  wwwRedirect?: cloudflare.Ruleset;
  formerWwwRedirect?: cloudflare.Ruleset;
}

export function managedHosts(args: {
  webDomain: string;
  appDomain: string;
  s3Domain: string;
  langfuseDomain?: string;
  qdrantDashboardDomain?: string;
  cmsDomain?: string;
  mcpGatewayDomain?: string;
}): string[] {
  return [
    args.webDomain,
    args.appDomain,
    args.s3Domain,
    ...(args.langfuseDomain !== undefined ? [args.langfuseDomain] : []),
    ...(args.qdrantDashboardDomain !== undefined ? [args.qdrantDashboardDomain] : []),
    ...(args.cmsDomain !== undefined ? [args.cmsDomain] : []),
    ...(args.mcpGatewayDomain !== undefined ? [args.mcpGatewayDomain] : []),
  ];
}

export function hostsOutsideZone(hosts: string[], zoneName: string): string[] {
  return hosts.filter((h) => h !== zoneName && !h.endsWith(`.${zoneName}`));
}

export function installDns(cfg: DeployConfig): ManagedDns | undefined {
  const dns = cfg.dns;
  if (!dns.enabled) {
    return undefined;
  }

  const provider = new cloudflare.Provider("cloudflare", { apiToken: dns.apiToken });
  const opts = { provider };

  const aRecord = (host: string, zoneId: string) =>
    new cloudflare.DnsRecord(
      `dns-${host}`,
      {
        zoneId,
        name: host,
        type: "A",
        content: dns.targetIp,
        ttl: dns.ttl,
        proxied: false,
        comment: "Managed by Pulumi (deploy/pulumi/src/platform/dns.ts)",
      },
      opts,
    );
  const hostRecords = dns.hosts.map((host) => aRecord(host, dns.zoneId));
  const formerHostRecords = dns.formerHosts.map((host) => aRecord(host, dns.formerZoneId));

  const baselineRecords: cloudflare.DnsRecord[] = [];
  let apexRedirect: ManagedDns["apexRedirect"];

  let wwwRedirect: ManagedDns["wwwRedirect"];
  let formerWwwRedirect: ManagedDns["formerWwwRedirect"];

  if (dns.zoneBaseline) {
    const servesApex = dns.hosts.includes(dns.zoneName);
    const former = dns.formerZoneBaseline;
    const suffix = former ? `-${dns.zoneName}` : "";
    const current = zoneBaseline(suffix, {
      zoneId: dns.zoneId,
      zoneName: dns.zoneName,
      proxied: dns.apexRedirectTo !== undefined || servesApex,
      dmarc: dns.dmarc,
      wwwRedirect: servesApex,
    }, dns.ttl, opts);
    baselineRecords.push(...current.records);
    wwwRedirect = current.wwwRedirect;
    if (former) {
      const kept = zoneBaseline("", {
        zoneId: dns.formerZoneId,
        zoneName: former.zoneName,
        proxied: true,
        dmarc: former.dmarc,
        wwwRedirect: true,
      }, dns.ttl, opts);
      baselineRecords.push(...kept.records);
      formerWwwRedirect = kept.wwwRedirect;
    }

    if (dns.apexRedirectTo !== undefined) {
      const placeholder = new cloudflare.DnsRecord(
        "dns-apex-placeholder",
        {
          zoneId: dns.zoneId,
          name: dns.zoneName,
          type: "A",
          content: UNROUTABLE_PLACEHOLDER,
          proxied: true,
          ttl: TTL_AUTOMATIC,
          comment: "Redirect placeholder — never receives traffic (Pulumi)",
        },
        opts,
      );

      const hosts = [dns.zoneName, `www.${dns.zoneName}`].map((h) => `"${h}"`).join(" ");
      const ruleset = new cloudflare.Ruleset(
        "dns-apex-redirect",
        {
          zoneId: dns.zoneId,
          name: "apex-redirect",
          kind: "zone",
          phase: "http_request_dynamic_redirect",
          description: `Apex and www to ${dns.apexRedirectTo} until a stack owns ${dns.zoneName}`,
          rules: [
            {
              action: "redirect",
              expression: `http.host in {${hosts}}`,
              description: "Apex placeholder redirect",
              actionParameters: {
                fromValue: {
                  targetUrl: { value: dns.apexRedirectTo },
                  statusCode: 302,
                  preserveQueryString: true,
                },
              },
            },
          ],
        },
        opts,
      );

      apexRedirect = { placeholder, ruleset };
    }

  }

  return { provider, hostRecords, formerHostRecords, baselineRecords, apexRedirect, wwwRedirect, formerWwwRedirect };
}

function zoneBaseline(
  suffix: string,
  zone: { zoneId: string; zoneName: string; proxied: boolean; dmarc?: string; wwwRedirect: boolean },
  ttl: number,
  opts: pulumi.CustomResourceOptions,
): { records: cloudflare.DnsRecord[]; wwwRedirect?: cloudflare.Ruleset } {
  const records = [
    new cloudflare.DnsRecord(
      `dns-www${suffix}`,
      {
        zoneId: zone.zoneId,
        name: `www.${zone.zoneName}`,
        type: "CNAME",
        content: zone.zoneName,
        ttl: zone.proxied ? TTL_AUTOMATIC : ttl,
        proxied: zone.proxied,
      },
      opts,
    ),
  ];
  if (zone.dmarc !== undefined) {
    records.push(
      new cloudflare.DnsRecord(
        `dns-dmarc${suffix}`,
        { zoneId: zone.zoneId, name: `_dmarc.${zone.zoneName}`, type: "TXT", content: zone.dmarc, ttl, proxied: false },
        opts,
      ),
    );
  }
  if (!zone.wwwRedirect) return { records };
  const wwwRedirect = new cloudflare.Ruleset(
    `dns-www-redirect${suffix}`,
    {
      zoneId: zone.zoneId,
      name: "www-redirect",
      kind: "zone",
      phase: "http_request_dynamic_redirect",
      description: `www to the ${zone.zoneName} apex this stack serves`,
      rules: [
        {
          action: "redirect",
          expression: `http.host eq "www.${zone.zoneName}"`,
          description: "www to apex",
          actionParameters: {
            fromValue: {
              targetUrl: { expression: `concat("https://${zone.zoneName}", http.request.uri.path)` },
              statusCode: 301,
              preserveQueryString: true,
            },
          },
        },
      ],
    },
    opts,
  );
  return { records, wwwRedirect };
}

export function managedRecordNames(dns: ManagedDns): pulumi.Output<string>[] {
  return [...dns.hostRecords, ...dns.formerHostRecords, ...dns.baselineRecords].map((r) => r.name);
}
