import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";

/**
 * Cloudflare Email Routing on project mail's receiving domain (`inbound-mail.ts`
 * puts the one routing rule and its Email Worker on it): the provider, the
 * guards, and the enablement. Normally a subdomain of the product's own zone
 * (`inbox.example.org`), so the apex keeps its own mail provider; project mail
 * may instead have a zone of its own (ADR-0138, the fallback).
 *
 * ## The MX guard, on the receiving domain
 *
 * Enabling Email Routing on a domain (`EmailRoutingDns`) points that domain's
 * MX at Cloudflare and locks them. If the domain already receives mail
 * elsewhere, that mail would go to Cloudflare from then on, where only the
 * project rule exists, and everything else is refused. So before anything is
 * created, the preview reads the receiving domain's MX records and refuses any
 * that point anywhere but Cloudflare's own `*.mx.cloudflare.net`.
 *
 * No MX at all passes: that is the first run on a fresh subdomain. Cloudflare's
 * MX passes: that is every run after it. Other names' MX records are not read:
 * routing on `inbox.example.org` does not touch the apex's (say Google
 * Workspace's `aspmx.l.google.com`), which is the point of the subdomain.
 *
 * ## Not managed here: subaddressing
 *
 * The project addresses are `project+<slug>.<token>@<domain>` and reach the rule
 * `project@<domain>` only with the zone's subaddressing setting on. The provider
 * (`@pulumi/cloudflare` 6.23.1, which bridges terraform-provider-cloudflare at
 * commit 9b51a582, its `upstream` submodule) has `supportSubaddress` only on
 * `EmailRoutingSettings`, and that resource cannot be used here (read
 * 2026-11-05 at that commit, `internal/services/email_routing_settings/resource.go`,
 * and cloudflare-go v7.13.1, `email_routing/emailrouting.go`):
 *
 *   - its create calls `EmailRouting.Enable`, `POST /zones/{zone}/email/routing/enable`
 *     with no body: the apex's onboarding ("Enable your Email Routing zone. Add
 *     and lock the necessary MX and SPF records"), which fails with error 2008
 *     beside Google Workspace's MX or, where it succeeds, takes the apex's mail.
 *     `supportSubaddress` is never sent;
 *   - its update is empty ("Update is not supported for this resource"), so a
 *     changed `supportSubaddress` is recorded in state and never reaches Cloudflare;
 *   - its delete calls `email/routing/disable` for the whole zone.
 *
 * The API that does set it is `PATCH /zones/{zone}/email/routing` with
 * `{"support_subaddress": true}` (cloudflare-go `EmailRouting.Edit`; that
 * endpoint's `enabled` field is documented as a no-op, "use POST/DELETE
 * /zones/{zone_id}/email/routing/dns"), which nothing in the provider calls.
 * So it stays one call by a person, the runbook's §7, checked by
 * `scripts/inbound-mail-smoke.ts g0` (gate G0); `inbound-mail.spec.ts` fails
 * if an `EmailRoutingSettings` is ever declared.
 *
 * ## The DMARC record, on the zone's apex
 *
 * `inboundMailDmarc` publishes `_dmarc.<zone apex>`, whose `sp=` covers the
 * receiving subdomain. Cloudflare accepts a second TXT record at the same name
 * without complaint, and a receiver that finds two DMARC records applies
 * neither (RFC 7489 §6.6.3). So before the record is registered the preview
 * reads the name's TXT records and refuses any DMARC record this stack did not
 * write (told apart by its comment): one written by hand, or by the DNS block
 * of a stack that owns the zone (`dnsDmarc`). `loadConfig` refuses the
 * same pair within one stack, `stack-files.spec.ts` across the committed ones.
 */

/** Cloudflare Email Routing's own MX hosts: `route1.mx.cloudflare.net` and its siblings. */
const CLOUDFLARE_MX = /\.mx\.cloudflare\.net$/;

/** The parts of a DNS record the MX guard reads. */
export interface MxRecord {
  name: string;
  content: string;
}

/**
 * Refuse a receiving domain whose MX records point anywhere but Cloudflare
 * Email Routing. Records on other names are ignored. `configKey` names the
 * stack key(s) that chose the domain, so the error says what to change.
 */
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

/** DNS names compare case-insensitively and with or without the root dot. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/** What the zone lookups yield once every guard has passed. */
export interface CheckedZone {
  /** The account that owns the zone: where Workers and destination addresses live. */
  accountId: string;
  zoneId: string;
  /** The zone's apex, e.g. `example.org`. */
  zoneName: string;
}

/**
 * Look up the zone and the receiving domain's MX, and run the guards inside
 * the lookup: `checkZoneName` (the caller's check of the zone's real name) and
 * the MX guard. Every Email Routing resource must take its zone or account id
 * from the result, so that none is registered, not even in a preview, unless
 * the guards passed.
 */
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

/** Email Routing on one receiving domain, guarded and enabled. */
export interface MailZone {
  provider: cloudflare.Provider;
  /** The receiving domain, e.g. `inbox.example.org`. */
  domain: string;
  /** Taken from the guarded lookup, so nothing using them exists unless the guards passed. */
  zoneId: pulumi.Output<string>;
  accountId: pulumi.Output<string>;
  /** The zone's apex, from the same lookup: where `_dmarc` lives. */
  zoneName: pulumi.Output<string>;
  /** Enables Email Routing on the domain and adds (and locks) its MX and SPF records. */
  routing: cloudflare.EmailRoutingDns;
}

/**
 * Refuse a zone the receiving domain does not live in: the domain must be the
 * zone's apex or a name under it. Thrown inside the zone lookup, so `pulumi
 * preview` fails before anything routes. `configKeys` names the stack keys
 * that chose the zone, so the error says what to change.
 */
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

/**
 * The routing resource's options beyond the provider. Exported for the spec:
 * Pulumi's mocks do not carry resource options.
 */
export const ROUTING_RESOURCE_OPTIONS = {
  // Deleting it (unsetting `inboundMailDomain`, or a destroy) calls Email
  // Routing's DNS delete for the zone, which may take every other routed
  // address of the zone with it. Turning project mail off must leave those be.
  retainOnDelete: true,
} as const satisfies pulumi.CustomResourceOptions;

/**
 * Email Routing on project mail's receiving domain, or undefined while no
 * domain is set. Declared while the feature is switched off too
 * (`inboundMailEnabled: false`): the disabled rule needs the routing, and the
 * routing is the zone's, not the feature's. `loadConfig` has already refused a
 * domain outside the DNS zone named by its id and project mail on the app zone
 * in a stack that does not own it; the zone lookup here refuses every other
 * mismatch at preview.
 */
export function installInboundMailZone(cfg: DeployConfig): MailZone | undefined {
  const mail = cfg.inboundMail;
  if (!mail.configured) return undefined;
  const configKeys = "inboundMailDomain";
  // A provider of its own rather than the DNS module's: that one exists only
  // inside `installDns`, and an inbox zone of its own need not be the DNS zone.
  const provider = new cloudflare.Provider("cloudflare-inbound-mail", { apiToken: mail.apiToken });

  const checked = checkedRoutingZone({
    configKey: configKeys,
    zoneId: mail.zoneId,
    domain: mail.domain,
    provider,
    checkZoneName: (zoneName) => assertDomainInZone(configKeys, mail.domain, mail.zoneId, zoneName),
  });

  // `email/routing/dns` (POST with `name`) enables routing on the named domain,
  // a subdomain included; the older `email/routing/enable`
  // (`EmailRoutingSettings`) always onboards the zone's apex.
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

/** The comment that marks the `_dmarc` record as this stack's, for the guard below. */
export function dmarcRecordComment(stack: string): string {
  return `Managed by Pulumi, stack ${stack}: inboundMailDmarc (deploy/pulumi/src/platform/email-routing.ts)`;
}

/** The parts of a DNS record the DMARC guard reads. */
export interface TxtRecord {
  name: string;
  content: string;
  comment?: string | null;
}

/**
 * Refuse a `_dmarc` name that already holds a DMARC record this stack did not
 * write: publishing ours beside it would leave two, and a receiver then
 * applies neither (RFC 7489 §6.6.3). Other TXT records at the name are not
 * DMARC records and are left alone.
 */
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

/**
 * The `_dmarc.<zone apex>` TXT record from `inboundMailDmarc`, or undefined
 * while it is unset. Its zone id comes out of the DMARC guard, so the record
 * is not registered, not even in a preview, unless the guard passed.
 */
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
