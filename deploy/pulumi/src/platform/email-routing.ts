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
 * The project addresses are `p+<slug>.<token>@<domain>` and reach the rule
 * `p@<domain>` only with the zone's subaddressing setting on. The provider
 * (`@pulumi/cloudflare` 6.23.1) has `supportSubaddress` only on
 * `EmailRoutingSettings`, whose create calls the zone's Email Routing ENABLE
 * endpoint (onboarding the APEX, which fails with "Non-Cloudflare MX records
 * exist" beside Google Workspace) without sending the field, whose update is a
 * no-op, and whose delete DISABLES Email Routing for the whole zone
 * (terraform-provider-cloudflare `internal/services/email_routing_settings`,
 * read 2026-11-03). So it is a dashboard step (Email Routing → Settings →
 * Subaddressing), checked by `scripts/inbound-mail-smoke.ts cloudflare`
 * (ADR-0138, gate G0).
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
    return { accountId: z.account.id, zoneId: args.zoneId };
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
    routing,
  };
}
