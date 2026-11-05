import { LEGACY_PROJECT } from "../names";
/**
 * Stack configurations for project mail (ADR-0138), on top of
 * {@link baseStackConfig}. Test support only; no value here is a real
 * credential.
 */

/** A stack that manages the app zone and owns it (`dnsEnabled` + `dnsZoneBaseline`). */
export const APP_ZONE_ID = "a".repeat(32);
export const APP_ZONE = "example.test";

export function appZoneStackConfig(): Record<string, string> {
  return {
    [`${LEGACY_PROJECT}:dnsEnabled`]: "true",
    [`${LEGACY_PROJECT}:dnsZoneId`]: APP_ZONE_ID,
    [`${LEGACY_PROJECT}:dnsZoneName`]: APP_ZONE,
    [`${LEGACY_PROJECT}:dnsZoneBaseline`]: "true",
    [`${LEGACY_PROJECT}:loadBalancerIp`]: "203.0.113.10",
    [`${LEGACY_PROJECT}:cloudflareApiToken`]: "cf-token", // pragma: allowlist secret
  };
}

/** The keyid and base64 secret of {@link SIGNING_KEYS}: 32 bytes of 0x11. */
export const SIGNING_KEY_ID = "mi-2026-10";
export const SIGNING_SECRET = Buffer.alloc(32, 0x11).toString("base64"); // pragma: allowlist secret

/** A zone of its own for the mail domain: `loadConfig` takes only a Cloudflare zone id's shape. */
export const MAIL_ZONE_ID = "0123456789abcdef0123456789abcdef";

/** Where `postmaster@` and `abuse@` forward to (RFC 2142). */
export const OPERATOR_ADDRESS = "mail-ops@company.example";

/** A one-key map, as `inboundMailSigningKeys` holds it. */
export const SIGNING_KEYS = JSON.stringify({ [SIGNING_KEY_ID]: SIGNING_SECRET });

/**
 * Everything project mail needs besides its domain and zone: the scanner it
 * refuses to run without, the signing keys, the Cloudflare token and the
 * operator's mailbox.
 */
export function mailStackConfig(): Record<string, string> {
  return {
    [`${LEGACY_PROJECT}:malwareScanEnabled`]: "true",
    [`${LEGACY_PROJECT}:inboundMailOperatorAddress`]: OPERATOR_ADDRESS,
    [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: SIGNING_KEYS,
    [`${LEGACY_PROJECT}:cloudflareApiToken`]: "cf-token", // pragma: allowlist secret
  };
}
