/**
 * Project mail's deploy config (ADR-0138): the receiving domain, its Cloudflare
 * zone, and the Worker's signing keys, checked together. Split from `config.ts`
 * like the other areas; `loadConfig` calls `inboundMailConfig`.
 */

import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { bool, requireSecretsTogether } from "./readers";

/** The keyid shape the BFF accepts (`usableSigningKeys`, `apps/workspace/bff/internal-auth.ts`). */
const SIGNING_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

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
  // On the app zone's apex (the recommended setup: addresses on the product's
  // own domain), the zone is the DNS zone and needs no second key.
  const zoneId =
    cfg.get("inboundMailZoneId") ?? (domain !== "" && domain === zone.dnsZoneName ? zone.dnsZoneId : "");
  const configured = domain !== "";
  const enabled = configured && bool(cfg, "inboundMailEnabled", true);
  const paused = bool(cfg, "inboundMailPaused", false);
  const off = {
    configured,
    enabled,
    paused,
    domain,
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
      `inboundMailDomain must be a bare domain name like "example.org" ` +
        `(got "${domain}"): no scheme, no "@", no path.`,
    );
  }
  requireSecretsTogether(
    cfg,
    ["cloudflareApiToken"],
    "when inboundMailDomain is set (a Cloudflare token that may write the Worker and the zone's " +
      "Email Routing; even managed off, the catch-all is this stack's)",
  );
  if (zoneId === "") {
    throw new Error(
      "inboundMailZoneId is required when inboundMailDomain is set: the " +
        "Cloudflare zone (dashboard → the zone → Overview → API) whose apex is that domain. " +
        "It may be left out when the domain is dnsZoneName.",
    );
  }
  // The one mistake this can see without calling Cloudflare. The catch-all
  // is an apex-only feature, so a subdomain of the DNS zone gets routing
  // enabled, MX records and a Worker, and then refuses every message to an
  // address nobody listed. `email-routing.ts` checks the general case against
  // the zone's real name at preview time.
  if (zoneId === zone.dnsZoneId && zone.dnsZoneName !== "" && domain !== zone.dnsZoneName) {
    throw new Error(
      `inboundMailDomain "${domain}" is not the apex of its zone ` +
        `("${zone.dnsZoneName}"). Cloudflare Email Routing has no catch-all for subdomains, so ` +
        "mail to project addresses there would be refused. Use the zone's apex " +
        `("${zone.dnsZoneName}") or a domain that is a zone apex of its own (see ` +
        'docs/deployment/kubernetes.md, "Project mail").',
    );
  }
  // On the app zone the catch-all is a zone-level object beside the apex's
  // MX and `_dmarc`: it belongs to the one stack that owns the zone. A second
  // stack would silently repoint the catch-all at its own Worker.
  if (zoneId === zone.dnsZoneId && (!zone.dnsEnabled || !zone.dnsZoneBaseline)) {
    throw new Error(
      "inboundMailDomain on the app zone needs dnsEnabled and " +
        "dnsZoneBaseline: the catch-all and the apex's mail routing are zone-level, " +
        "and only the stack owning the zone may manage them.",
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
