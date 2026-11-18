import * as pulumi from "@pulumi/pulumi";
import type { DnsConfig } from "./dns";
import { dmarcRecordProblem } from "./dmarc";
import { bool, requireSecretsTogether } from "./readers";

const SIGNING_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface InboundMailConfig {
  configured: boolean;
  enabled: boolean;
  paused: boolean;
  directFiling: boolean;
  domain: string;
  localPart: string;
  zoneId: string;
  signingKeys: pulumi.Output<string>;
  signingKeyId: string;
  signingKey: pulumi.Output<string>;
  apiToken: pulumi.Output<string>;
  operatorAddress: string;
  operatorAddressShared: boolean;
  dmarc?: string;
}

export const RFC2142_LOCAL_PARTS = ["postmaster", "abuse"] as const;

const ZONE_ID = /^[0-9a-f]{32}$/;

const MAILBOX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export const DEFAULT_INBOUND_MAIL_LOCAL_PART = "project";

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function withinZone(domain: string, zone: string): boolean {
  return domain === zone || domain.endsWith(`.${zone}`);
}

const SIGNING_KEYS_HINT =
  'inboundMailSigningKeys is a JSON object of keyid to a base64 secret of at least 32 bytes, ' +
  'set with `pulumi config set --secret inboundMailSigningKeys \'{"mi-2026-10":"<openssl rand -base64 32>"}\'`';

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
    if (secret === Buffer.from("internal-dev-signing-secret-0032").toString("base64")) {
      throw new Error(`${SIGNING_KEYS_HINT}; "${keyId}" holds the well-known development secret.`);
    }
  }
  return entries.map(([keyId]) => keyId);
}

export interface InboundMailZoneContext {
  dns: Pick<DnsConfig, "enabled" | "zoneId" | "zoneName" | "zoneBaseline" | "dmarc">;
  cloudflareApiToken: pulumi.Output<string> | undefined;
  malwareScanEnabled: boolean;
}

function assertMailZone(
  domain: string,
  zoneId: string,
  explicitZoneId: string | undefined,
  dns: InboundMailZoneContext["dns"],
): void {
  if (zoneId === "") {
    throw new Error(
      "inboundMailZoneId is required when inboundMailDomain is set: the " +
        "Cloudflare zone (dashboard → the zone → Overview → API) the domain lives in. " +
        "It may be left out when the domain is dnsZoneName or a subdomain of it.",
    );
  }
  if (explicitZoneId !== undefined && !ZONE_ID.test(explicitZoneId)) {
    throw new Error(
      `inboundMailZoneId must be a Cloudflare zone id, 32 hex digits (got "${explicitZoneId}"): ` +
        "dashboard → the zone → Overview → API → Zone ID.",
    );
  }
  if (zoneId === dns.zoneId && dns.zoneName !== "" && !withinZone(domain, dns.zoneName)) {
    throw new Error(
      `inboundMailDomain "${domain}" is not in its zone ("${dns.zoneName}"). Use a subdomain ` +
        `of it (e.g. "inbox.${dns.zoneName}") or set inboundMailZoneId to the domain's own zone.`,
    );
  }
  if (zoneId === dns.zoneId && (!dns.enabled || !dns.zoneBaseline)) {
    throw new Error(
      "inboundMailDomain on the app zone needs dnsEnabled and " +
        "dnsZoneBaseline: Email Routing is zone-level, " +
        "and only the stack owning the zone may manage it.",
    );
  }
}

function assertOperatorAddress(address: string, domain: string): void {
  if (address === "") {
    throw new Error(
      "inboundMailOperatorAddress is required when inboundMailDomain is set: the mailbox " +
        `postmaster@${domain} and abuse@${domain} forward to (RFC 2142), on the company's own mail, ` +
        'e.g. "mail-ops@example.org". Cloudflare sends it a verification mail on the first deploy.',
    );
  }
  if (!MAILBOX.test(address)) {
    throw new Error(
      `inboundMailOperatorAddress must be one mailbox address like "mail-ops@example.org" (got "${address}"): ` +
        "no display name, no list.",
    );
  }
  if (withinZone(address.slice(address.lastIndexOf("@") + 1), domain)) {
    throw new Error(
      `inboundMailOperatorAddress "${address}" is on the receiving domain ${domain}, where only the ` +
        "project rule and the two forwards exist: the forwarded mail would bounce. Use a mailbox elsewhere.",
    );
  }
}

function assertMailDmarc(dmarc: string, zoneId: string, dns: InboundMailZoneContext["dns"]): void {
  const problem = dmarcRecordProblem(dmarc);
  if (problem !== undefined) {
    throw new Error(
      `inboundMailDmarc is not a DMARC record: ${problem}. Recommended: ` +
        '"v=DMARC1; p=none; sp=none; adkim=r; aspf=r; rua=mailto:<inboundMailOperatorAddress>".',
    );
  }
  if (zoneId === dns.zoneId && dns.enabled && dns.zoneBaseline && dns.dmarc !== undefined) {
    throw new Error(
      `inboundMailDmarc and dnsDmarc both publish _dmarc.${dns.zoneName}: two DMARC records make every ` +
        "receiver ignore both (RFC 7489 §6.6.3). Keep one: dnsDmarc on the app zone, inboundMailDmarc on a mail zone of its own.",
    );
  }
}

export function inboundMailConfig(cfg: pulumi.Config, context: InboundMailZoneContext): InboundMailConfig {
  const { dns } = context;
  const domain = (cfg.get("inboundMailDomain") ?? "").trim().toLowerCase().replace(/\.$/, "");
  const localPart = (cfg.get("inboundMailLocalPart") ?? DEFAULT_INBOUND_MAIL_LOCAL_PART).trim().toLowerCase();
  const explicitZoneId = cfg.get("inboundMailZoneId")?.trim();
  const zoneId =
    explicitZoneId ?? (domain !== "" && dns.zoneName !== "" && withinZone(domain, dns.zoneName) ? dns.zoneId : "");
  const configured = domain !== "";
  const enabled = configured && bool(cfg, "inboundMailEnabled", true);
  const paused = bool(cfg, "inboundMailPaused", false);
  const directFiling = bool(cfg, "inboundMailDirectFiling", true);
  const dmarc = cfg.get("inboundMailDmarc")?.trim() || undefined;
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
    apiToken: context.cloudflareApiToken ?? pulumi.secret(""),
    operatorAddress: (cfg.get("inboundMailOperatorAddress") ?? "").trim().toLowerCase(),
    operatorAddressShared: bool(cfg, "inboundMailOperatorAddressShared", false),
    dmarc,
  };
  if (!configured) {
    if (dmarc !== undefined) {
      throw new Error(
        "inboundMailDmarc is set without inboundMailDomain: the record is published on the mail zone, " +
          "which only the domain names. Set dnsDmarc for a zone without project mail.",
      );
    }
    return off;
  }

  if (!context.malwareScanEnabled) {
    throw new Error(
      "inboundMailDomain needs malwareScanEnabled=true: mail from anyone is scanned by " +
        "the in-cluster ClamAV before it can be filed or downloaded (ADR-0157), and without the scanner " +
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
  assertMailZone(domain, zoneId, explicitZoneId, dns);
  assertOperatorAddress(off.operatorAddress, domain);
  if (dmarc !== undefined) assertMailDmarc(dmarc, zoneId, dns);
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

export function inboundMailAppEnv(mail: InboundMailConfig): { name: string; value: string }[] {
  if (!mail.enabled) return [];
  return [
    { name: "INBOUND_MAIL_DOMAIN", value: mail.domain },
    { name: "INBOUND_MAIL_LOCAL_PART", value: mail.localPart },
    { name: "INBOUND_MAIL_PAUSED", value: String(mail.paused) },
    { name: "INBOUND_MAIL_DIRECT_FILING", value: String(mail.directFiling) },
  ];
}
