import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";

const CLOUDFLARE_MX = /\.mx\.cloudflare\.net$/;

export interface MxRecord {
  name: string;
  content: string;
}

export function assertNoForeignMx(
  configKey: string,
  domain: string,
  zoneId: string,
  records: readonly MxRecord[],
): void {
  const foreign = records
    .filter((r) => normalizeHost(r.name) === domain)
    .map((r) => normalizeHost(r.content))
    .filter((host) => !CLOUDFLARE_MX.test(host));
  if (foreign.length === 0) return;
  throw new Error(
    `${configKey} put Cloudflare Email Routing on "${domain}" (zone ${zoneId}), but ` +
      `that domain already receives mail elsewhere: its MX records point at ` +
      `${foreign.map((h) => h || ".").join(", ")}. Email Routing would take its MX over and ` +
      'capture that mail. Use a subdomain nothing else receives mail on (e.g. "inbox.<domain>"), ' +
      "or remove those MX records if nothing should receive mail there.",
  );
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export interface CheckedZone {
  accountId: string;
  zoneId: string;
  zoneName: string;
}

export function checkedRoutingZone(args: {
  configKey: string;
  zoneId: string;
  domain: string;
  provider: cloudflare.Provider;
  checkZoneName: (zoneName: string) => void;
}): pulumi.Output<CheckedZone> {
  const opts = { provider: args.provider };
  const zone = cloudflare.getZoneOutput({ zoneId: args.zoneId }, opts);
  const mx = cloudflare.getDnsRecordsOutput(
    { zoneId: args.zoneId, type: "MX", name: { exact: args.domain } },
    opts,
  );
  return pulumi.all([zone, mx]).apply(([z, records]) => {
    args.checkZoneName(z.name);
    assertNoForeignMx(args.configKey, args.domain, args.zoneId, records.results);
    return { accountId: z.account.id, zoneId: args.zoneId, zoneName: z.name };
  });
}

export interface MailZone {
  provider: cloudflare.Provider;
  domain: string;
  zoneId: pulumi.Output<string>;
  accountId: pulumi.Output<string>;
  zoneName: pulumi.Output<string>;
  routing: cloudflare.EmailRoutingDns;
}

export function assertDomainInZone(
  configKeys: string,
  domain: string,
  zoneId: string,
  zoneName: string,
): void {
  if (domain === zoneName || domain.endsWith(`.${zoneName}`)) return;
  throw new Error(
    `${configKeys} route mail on "${domain}", but zone ${zoneId} is "${zoneName}". The ` +
      "domain must be that zone's apex or a subdomain of it: a zone id naming another zone " +
      "would route mail there.",
  );
}

export const ROUTING_RESOURCE_OPTIONS = {
  retainOnDelete: true,
} as const satisfies pulumi.CustomResourceOptions;

export function installInboundMailZone(cfg: DeployConfig): MailZone | undefined {
  const mail = cfg.inboundMail;
  if (!mail.configured) return undefined;
  const configKeys = "inboundMailDomain";
  const provider = new cloudflare.Provider("cloudflare-inbound-mail", { apiToken: mail.apiToken });

  const checked = checkedRoutingZone({
    configKey: configKeys,
    zoneId: mail.zoneId,
    domain: mail.domain,
    provider,
    checkZoneName: (zoneName) => assertDomainInZone(configKeys, mail.domain, mail.zoneId, zoneName),
  });

  const routing = new cloudflare.EmailRoutingDns(
    "inbound-mail-routing",
    { zoneId: checked.zoneId, name: mail.domain },
    { provider, ...ROUTING_RESOURCE_OPTIONS },
  );

  return {
    provider,
    domain: mail.domain,
    zoneId: checked.zoneId,
    accountId: checked.accountId,
    zoneName: checked.zoneName,
    routing,
  };
}

export function dmarcRecordComment(stack: string): string {
  return `Managed by Pulumi, stack ${stack}: inboundMailDmarc (deploy/pulumi/src/platform/email-routing.ts)`;
}

export interface TxtRecord {
  name: string;
  content: string;
  comment?: string | null;
}

export function assertNoForeignDmarc(name: string, zoneId: string, comment: string, records: readonly TxtRecord[]): void {
  const foreign = records
    .filter((r) => normalizeHost(r.name) === name)
    .filter((r) => /^v=DMARC1\s*(;|$)/i.test(r.content.trim().replace(/^"|"$/g, "")))
    .filter((r) => r.comment !== comment);
  if (foreign.length === 0) return;
  throw new Error(
    `inboundMailDmarc would publish ${name} (zone ${zoneId}), but that name already holds a DMARC record ` +
      `this stack did not write: ${foreign.map((r) => JSON.stringify(r.content)).join(", ")}${foreign[0].comment ? ` (comment: "${foreign[0].comment}")` : ""}. ` +
      "Two DMARC records make every receiver ignore both. Keep one owner: unset inboundMailDmarc and keep that " +
      "record, or delete it (and unset dnsDmarc on the stack that wrote it) and let this stack publish.",
  );
}

export function installMailZoneDmarc(cfg: DeployConfig, zone: MailZone): cloudflare.DnsRecord | undefined {
  const content = cfg.inboundMail.dmarc;
  if (content === undefined) return undefined;
  const opts = { provider: zone.provider };
  const comment = dmarcRecordComment(pulumi.getStack());
  const name = zone.zoneName.apply((apex) => `_dmarc.${apex}`);
  const existing = cloudflare.getDnsRecordsOutput({ zoneId: zone.zoneId, type: "TXT", name: { exact: name } }, opts);
  const zoneId = pulumi.all([zone.zoneId, name, existing]).apply(([id, dmarcName, records]) => {
    assertNoForeignDmarc(dmarcName, id, comment, records.results);
    return id;
  });
  return new cloudflare.DnsRecord(
    "inbound-mail-dmarc",
    { zoneId, name, type: "TXT", content, ttl: cfg.dns.ttl, proxied: false, comment },
    opts,
  );
}
