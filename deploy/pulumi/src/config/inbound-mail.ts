/**
 * Project mail's deploy config (ADR-0138): the receiving domain and local part,
 * its Cloudflare zone, and the Worker's signing keys, checked together. Split from `config.ts`
 * like the other areas; `loadConfig` calls `inboundMailConfig`.
 */

import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { bool, requireSecretsTogether } from "./readers";

/** The keyid shape the BFF accepts (`usableSigningKeys`, `apps/workspace/bff/internal-auth.ts`). */
const SIGNING_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The local part when `inboundMailLocalPart` is unset: addresses are
 * `p+<slug>.<token>@<domain>`. `DEFAULT_LOCAL_PART` in the BFF's `address.ts`
 * and `localPart` in `contracts/inbound-address.json` say the same.
 */
export const DEFAULT_INBOUND_MAIL_LOCAL_PART = "p";

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
export function inboundMailConfig(cfg: pulumi.Config, zone: InboundMailZoneContext): DeployConfig["inboundMail"] {
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
  const off = {
    configured,
    enabled,
    paused,
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
        "the in-cluster ClamAV before it can be filed or downloaded (ADR-0150), and without the scanner " +
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
        `(got "${localPart}"): it is the "p" of p+<slug>.<token>@${domain}, so never a "+" or a dot.`,
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
