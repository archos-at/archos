import { LEGACY_PROJECT } from "../names";

export const APP_ZONE_ID = "000000000000000000000000000a0001";
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

export const SIGNING_KEY_ID = "mi-2026-10";
export const SIGNING_SECRET = Buffer.alloc(32, 0x11).toString("base64"); // pragma: allowlist secret

export const MAIL_ZONE_ID = "0123456789abcdef0123456789abcdef";

export const OPERATOR_ADDRESS = "mail-ops@company.example";

export const SIGNING_KEYS = JSON.stringify({ [SIGNING_KEY_ID]: SIGNING_SECRET });

export function mailStackConfig(): Record<string, string> {
  return {
    [`${LEGACY_PROJECT}:malwareScanEnabled`]: "true",
    [`${LEGACY_PROJECT}:inboundMailOperatorAddress`]: OPERATOR_ADDRESS,
    [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: SIGNING_KEYS,
    [`${LEGACY_PROJECT}:cloudflareApiToken`]: "cf-token", // pragma: allowlist secret
  };
}
