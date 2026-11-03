/**
 * Project mail's deploy config (ADR-0138): the receiving domain and local part,
 * its Cloudflare zone, and the Worker's signing keys, checked together. Split from `config.ts`
 * like the other areas; `loadConfig` calls `inboundMailConfig`.
 */

import * as pulumi from "@pulumi/pulumi";
import { bool, requireSecretsTogether } from "./readers";

/** The keyid shape the BFF accepts (`usableSigningKeys`, `apps/workspace/bff/internal-auth.ts`). */
const SIGNING_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The local part when `inboundMailLocalPart` is unset: addresses are
 * `project+<slug>.<token>@<domain>`. `DEFAULT_LOCAL_PART` in the BFF's `address.ts`
 * and `localPart` in `contracts/inbound-address.json` say the same.
 */
/**
 * Project mail (ADR-0138, `platform/inbound-mail.ts`): Cloudflare Email
 * Routing on `domain` (a subdomain such as `inbox.example.org`), whose one
 * literal rule `<localPart>@<domain>` hands the Email Worker every
 * `<localPart>+<slug>.<token>@<domain>` through subaddressing. The Worker
 * signs each message (RFC 9421) and posts it to the BFF's
 * `/api/internal/signed/inbound-mail`.
 *
 * Three states, outermost switch first:
 *   - **unset** (`inboundMailDomain` absent): nothing at Cloudflare, no
 *     `INBOUND_MAIL_DOMAIN` on the frontend (the UI shows no address),
 *     an empty key map (the route answers 503).
 *   - **on**: routing, the rule pointing at the Worker, the Worker.
 *   - **managed off** (`inboundMailEnabled: false`, the domain kept): the
 *     rule stays declared but disabled, so Cloudflare refuses the addresses
 *     at SMTP time and the sender learns to write elsewhere; the Worker is
 *     deleted once the rule no longer names it. Removing the feature for
 *     good is this first, then the domain (Email Routing itself is kept,
 *     `retainOnDelete`).
 *
 * `paused` is the incident lever inside "on": every delivery fails
 * temporarily and senders retry for days; nothing bounces, nothing is lost.
 * `directFiling` is the narrower one: mail is still received, but a verified
 * writer's mail waits for its member instead of being filed as them.
 */
export interface InboundMailConfig {
  /** `inboundMailDomain` is set: Email Routing and the rule are this stack's. */
  configured: boolean;
  /** Configured and not switched off: the Worker runs and the rule points at it. */
  enabled: boolean;
  /** Every delivery is answered with a temporary failure (`inboundMailPaused`). */
  paused: boolean;
  /**
   * A verified writer's mail is filed directly as them (`inboundMailDirectFiling`,
   * default true). False is the kill switch of that path alone: such mail is
   * queued no sender job and waits for any of the project's writers, as all
   * mail did before direct filing. The BFF's `INBOUND_MAIL_DIRECT_FILING`, read
   * where the receive job queues the sender's filing (`bff-jobs`), by that job,
   * and for the wait reason the E-Mail-Eingang shows.
   */
  directFiling: boolean;
  /**
   * The receiving domain, inside the zone `zoneId` names: a subdomain of the
   * app zone (`inbox.example.org`, the recommended setup, which leaves the
   * apex's MX to the company's mail provider) or a domain of its own. The
   * BFF's `INBOUND_MAIL_DOMAIN`, the Worker's `ADDRESS_DOMAIN`.
   */
  domain: string;
  /**
   * The local part of the one routing rule and of every project address,
   * in front of the `+` (`inboundMailLocalPart`, default `project`). The BFF's
   * `INBOUND_MAIL_LOCAL_PART`, the Worker's `ADDRESS_LOCAL_PART`.
   */
  localPart: string;
  /** Cloudflare zone `domain` lives in; `dns.zoneId` when `domain` is `dns.zoneName` or under it. */
  zoneId: string;
  /**
   * The BFF's key map, `INBOUND_MAIL_SIGNING_KEYS`: JSON, keyid →
   * base64 secret, one or two entries. Empty while not enabled.
   */
  signingKeys: pulumi.Output<string>;
  /** The keyid the Worker signs with, a key of `signingKeys`. */
  signingKeyId: string;
  /** Its secret, base64, bound to the Worker as `SIGNING_KEY`. */
  signingKey: pulumi.Output<string>;
  /** The same `cloudflareApiToken` DNS uses, with the scopes `platform/inbound-mail.ts` lists. */
  apiToken: pulumi.Output<string>;
}

export const DEFAULT_INBOUND_MAIL_LOCAL_PART = "project";

/** The BFF's `LOCAL_PART_PATTERN`: no `+`, no dot, nothing a client would quote. */
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Whether `domain` is `zone` itself or a name under it. */
function withinZone(domain: string, zone: string): boolean {
  return domain === zone || domain.endsWith(`.${zone}`);
}

/** What `pulumi config set` must be given for a signing key, in every message that refuses one. */
const SIGNING_KEYS_HINT =
  'inboundMailSigningKeys is a JSON object of keyid to a base64 secret of at least 32 bytes, ' +
  'set with `pulumi config set --secret inboundMailSigningKeys \'{"mi-2026-10":"<openssl rand -base64 32>"}\'`';

/**
 * The Worker's key map, checked the way the BFF checks it, because the BFF
 * answers a map it cannot use with a 503 on every delivery: the senders retry
 * for days and then bounce, and nothing in the plan would have failed. Returns
 * the keyids; only key NAMES and counts ever reach a message.
 */
function assertSigningKeys(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${SIGNING_KEYS_HINT}; the value is not JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${SIGNING_KEYS_HINT}; the value is not an object.`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 2) {
    throw new Error(
      `${SIGNING_KEYS_HINT}, with one or two entries (two only while rotating); it has ${entries.length}.`,
    );
  }
  for (const [keyId, secret] of entries) {
    if (!SIGNING_KEY_ID.test(keyId)) {
      throw new Error(`${SIGNING_KEYS_HINT}; the keyid "${keyId}" is not [A-Za-z0-9._-]{1,64}.`);
    }
    const base64 = typeof secret === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(secret) && secret.length % 4 === 0;
    if (!base64 || Buffer.from(secret as string, "base64").length < 32) {
      throw new Error(`${SIGNING_KEYS_HINT}; the secret of "${keyId}" is not base64 of at least 32 bytes.`);
    }
    // `DEV_DEFAULT_SIGNING_SECRET`, which the BFF refuses outside development.
    if (secret === Buffer.from("internal-dev-signing-secret-0032").toString("base64")) {
      throw new Error(`${SIGNING_KEYS_HINT}; "${keyId}" holds the well-known development secret.`);
    }
  }
  return entries.map(([keyId]) => keyId);
}

/** What `inboundMailConfig` needs from the DNS section, already validated there. */
export interface InboundMailZoneContext {
  dnsEnabled: boolean;
  dnsZoneId: string;
  dnsZoneName: string;
  dnsZoneBaseline: boolean;
  cloudflareApiToken: pulumi.Output<string> | undefined;
  malwareScanEnabled: boolean;
}

/**
 * Project mail (ADR-0138). Opt-in by setting the domain; everything else is
 * then required together, because each half alone fails silently: a domain
 * without a usable key map is a Worker whose every delivery answers 503 (the
 * sender retries for days, then bounces), and a domain without the zone has
 * nowhere to enable routing.
 */
export function inboundMailConfig(cfg: pulumi.Config, zone: InboundMailZoneContext): InboundMailConfig {
  const domain = (cfg.get("inboundMailDomain") ?? "").trim().toLowerCase().replace(/\.$/, "");
  const localPart = (cfg.get("inboundMailLocalPart") ?? DEFAULT_INBOUND_MAIL_LOCAL_PART).trim().toLowerCase();
  // On the app zone (the recommended setup: a subdomain of the product's own
  // domain, `inbox.example.org`), the zone is the DNS zone and needs no second key.
  const zoneId =
    cfg.get("inboundMailZoneId") ??
    (domain !== "" && zone.dnsZoneName !== "" && withinZone(domain, zone.dnsZoneName) ? zone.dnsZoneId : "");
  const configured = domain !== "";
  const enabled = configured && bool(cfg, "inboundMailEnabled", true);
  const paused = bool(cfg, "inboundMailPaused", false);
  const directFiling = bool(cfg, "inboundMailDirectFiling", true);
  const off = {
    configured,
    enabled,
    paused,
    directFiling,
    domain,
    localPart,
    zoneId,
    signingKeys: pulumi.secret(""),
    signingKeyId: "",
    signingKey: pulumi.secret(""),
    apiToken: zone.cloudflareApiToken ?? pulumi.secret(""),
  };
  if (!configured) return off;

  if (!zone.malwareScanEnabled) {
    // Strangers can write to a project address (DECISION D3), and every part
    // of what they send is scanned before anyone may file or download it. With
    // the scanner off every scan fails closed, so every mail would wait
    // forever: refuse the combination rather than deploy a feature that
    // cannot file anything.
    throw new Error(
      "inboundMailDomain needs malwareScanEnabled=true: mail from anyone is scanned by " +
        "the in-cluster ClamAV before it can be filed or downloaded (ADR-0152), and without the scanner " +
        "nothing that arrives could ever be filed.",
    );
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error(
      `inboundMailDomain must be a bare domain name like "inbox.example.org" ` +
        `(got "${domain}"): no scheme, no "@", no path.`,
    );
  }
  if (!LOCAL_PART.test(localPart)) {
    // The BFF refuses the same value at runtime; a deploy that mints
    // addresses no rule routes must fail at preview instead.
    throw new Error(
      `inboundMailLocalPart must be 1 to 32 of [a-z0-9-], without a hyphen at either end ` +
        `(got "${localPart}"): it is the "project" of project+<slug>.<token>@${domain}, so never a "+" or a dot.`,
    );
  }
  requireSecretsTogether(
    cfg,
    ["cloudflareApiToken"],
    "when inboundMailDomain is set (a Cloudflare token that may write the Worker and the zone's " +
      "Email Routing; even managed off, the routing rule is this stack's)",
  );
  if (zoneId === "") {
    throw new Error(
      "inboundMailZoneId is required when inboundMailDomain is set: the " +
        "Cloudflare zone (dashboard → the zone → Overview → API) the domain lives in. " +
        "It may be left out when the domain is dnsZoneName or a subdomain of it.",
    );
  }
  // The one mistake this can see without calling Cloudflare: a zone id that
  // names the DNS zone for a domain outside it. `email-routing.ts` checks the
  // general case against the zone's real name at preview time.
  if (zoneId === zone.dnsZoneId && zone.dnsZoneName !== "" && !withinZone(domain, zone.dnsZoneName)) {
    throw new Error(
      `inboundMailDomain "${domain}" is not in its zone ("${zone.dnsZoneName}"). Use a subdomain ` +
        `of it (e.g. "inbox.${zone.dnsZoneName}") or set inboundMailZoneId to the domain's own zone.`,
    );
  }
  // On the app zone Email Routing's enablement is one object per zone (the
  // provider keys it by zone id) beside the apex's MX and `_dmarc`: it belongs
  // to the one stack that owns the zone. A second stack would fight over it.
  if (zoneId === zone.dnsZoneId && (!zone.dnsEnabled || !zone.dnsZoneBaseline)) {
    throw new Error(
      "inboundMailDomain on the app zone needs dnsEnabled and " +
        "dnsZoneBaseline: Email Routing is zone-level, " +
        "and only the stack owning the zone may manage it.",
    );
  }
  if (!enabled) return off;

  requireSecretsTogether(
    cfg,
    ["inboundMailSigningKeys"],
    "when inboundMailDomain is set and the inbox is on (the keys the Worker signs with and " +
      "the BFF verifies, ADR-0138)",
  );
  const keyIds = assertSigningKeys((cfg.get("inboundMailSigningKeys") ?? "").trim());
  const signingKeyId = cfg.get("inboundMailSigningKeyId") ?? (keyIds.length === 1 ? keyIds[0] : "");
  if (!keyIds.includes(signingKeyId)) {
    throw new Error(
      `inboundMailSigningKeyId must name the key the Worker signs with, one of ` +
        `${keyIds.map((k) => `"${k}"`).join(", ")} (got "${signingKeyId}"). With two keys (a rotation) ` +
        "it is required: the BFF accepts both while the Worker moves from the old to the new.",
    );
  }
  const signingKeys = cfg.requireSecret("inboundMailSigningKeys").apply((v) => v.trim());
  return {
    ...off,
    signingKeys,
    signingKeyId,
    signingKey: signingKeys.apply((v) => (JSON.parse(v) as Record<string, string>)[signingKeyId]),
  };
}

/**
 * The application's project-mail variables while the inbox is on: the domain
 * (absent hides the address in the UI), the local part, the pause (the webhook
 * answers 503) and the direct-filing switch. Nothing while it is off.
 */
export function inboundMailAppEnv(mail: InboundMailConfig): { name: string; value: string }[] {
  if (!mail.enabled) return [];
  return [
    { name: "INBOUND_MAIL_DOMAIN", value: mail.domain },
    { name: "INBOUND_MAIL_LOCAL_PART", value: mail.localPart },
    { name: "INBOUND_MAIL_PAUSED", value: String(mail.paused) },
    { name: "INBOUND_MAIL_DIRECT_FILING", value: String(mail.directFiling) },
  ];
}
