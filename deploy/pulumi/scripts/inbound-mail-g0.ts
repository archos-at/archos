import { DEFAULT_INBOUND_MAIL_LOCAL_PART, RFC2142_LOCAL_PARTS } from "../src/config/inbound-mail";

const CLOUDFLARE_MX = /\.mx\.cloudflare\.net\.?$/i;

export interface Finding {
  gate: string;
  name: string;
  status: "pass" | "fail" | "manual" | "info";
  detail: string;
}

export interface Rule {
  enabled?: boolean;
  matchers?: Array<{ type?: string; field?: string; value?: string }>;
  actions?: Array<{ type?: string; value?: string[]; values?: string[] }>;
}

export interface RoutingSettings {
  enabled?: boolean;
  status?: string;
  name?: string;
  support_subaddress?: boolean;
}

export { RFC2142_LOCAL_PARTS };

export interface DestinationAddress {
  email?: string;
  verified?: string | null;
}

export function localPartFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.INBOUND_MAIL_LOCAL_PART?.trim() || DEFAULT_INBOUND_MAIL_LOCAL_PART).toLowerCase();
}

function host(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

export function mxHostsFromDoh(answer: { Status?: number; Answer?: Array<{ type?: number; data?: string }> }): string[] {
  if (answer.Status === 3) return [];
  if (answer.Status !== 0) throw new Error(`DNS lookup failed with status ${answer.Status}`);
  return (answer.Answer ?? [])
    .filter((record) => record.type === 15 && typeof record.data === "string")
    .map((record) => host((record.data as string).trim().split(/\s+/).pop() ?? ""))
    .sort();
}

export function receivingMxFinding(domain: string, hosts: string[]): Finding {
  const foreign = hosts.filter((h) => !CLOUDFLARE_MX.test(h));
  const ok = hosts.length > 0 && foreign.length === 0;
  const detail =
    hosts.length === 0
      ? "none: Email Routing is not enabled on the subdomain yet (the paused promote enables it), or DNS has not propagated"
      : hosts.join(", ");
  return { gate: "G0", name: `MX of ${domain} (public DNS)`, status: ok ? "pass" : "fail", detail };
}

export type ApexExpectation = string[] | "cloudflare";

export function apexMxFinding(apex: string, hosts: string[], expected?: ApexExpectation): Finding {
  const name = `MX of the apex ${apex} (public DNS), unchanged`;
  const listed = hosts.join(", ") || "none";
  if (expected === "cloudflare") {
    const ok = hosts.length > 0 && hosts.every((h) => CLOUDFLARE_MX.test(h));
    return { gate: "G0", name, status: ok ? "pass" : "fail", detail: `${listed}; expected Cloudflare's (apex onboarded on purpose)` };
  }
  if (hosts.some((h) => CLOUDFLARE_MX.test(h))) {
    return { gate: "G0", name, status: "fail", detail: `${listed}: the apex was onboarded to Email Routing; restore its provider's MX now` };
  }
  if (expected === undefined) return { gate: "G0", name, status: "pass", detail: `${listed} (not Cloudflare's)` };
  const want = expected.map(host).sort();
  const same = want.length === hosts.length && want.every((h, i) => h === hosts[i]);
  return { gate: "G0", name, status: same ? "pass" : "fail", detail: `${listed}; expected ${want.join(", ") || "none"}` };
}

export function expectedApexMx(raw: string | undefined): ApexExpectation | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.toLowerCase() === "none") return [];
  if (value.toLowerCase() === "cloudflare") return "cloudflare";
  return value.split(",").map(host).filter((h) => h !== "");
}

export function zoneRoutingFinding(settings: RoutingSettings): Finding {
  return {
    gate: "G0",
    name: "Email Routing on the zone (the apex's state)",
    status: "info",
    detail: `enabled=${settings.enabled} status=${settings.status}; the apex need not be onboarded`,
  };
}

export function subaddressFinding(settings: RoutingSettings): Finding {
  const on = settings.support_subaddress === true;
  return {
    gate: "G0",
    name: "subaddressing on the zone",
    status: on ? "pass" : "fail",
    detail: `support_subaddress=${settings.support_subaddress}${on ? "" : ": the runbook's §7, PATCH /zones/{zone}/email/routing {\"support_subaddress\":true}"}`,
  };
}

function literals(rule: Rule): string[] {
  return (rule.matchers ?? []).filter((m) => m.type === "literal" && m.value).map((m) => (m.value as string).toLowerCase());
}

function targets(rule: Rule): string[] {
  const action = rule.actions?.[0];
  return [...(action?.value ?? []), ...(action?.values ?? [])];
}

export function classifyDomainRules(rules: Rule[], domain: string, localPart: string) {
  const onDomain = rules.filter((r) => literals(r).some((v) => v.endsWith(`@${domain}`)));
  const at = (local: string) => onDomain.find((r) => literals(r).includes(`${local}@${domain}`));
  const project = at(localPart);
  const rfc2142 = RFC2142_LOCAL_PARTS.map((local) => [local, at(local)] as const);
  const known = new Set<Rule | undefined>([project, ...rfc2142.map(([, rule]) => rule)]);
  return { project, rfc2142, others: onDomain.filter((r) => !known.has(r)) };
}

export function ruleFindings(rules: Rule[], domain: string, localPart: string, worker?: string): Finding[] {
  const { project, rfc2142, others } = classifyDomainRules(rules, domain, localPart);
  const toWorker =
    project !== undefined &&
    project.enabled !== false &&
    project.actions?.[0]?.type === "worker" &&
    (worker === undefined || targets(project).includes(worker));
  const missingForwards = rfc2142
    .filter(([, rule]) => rule === undefined || rule.enabled === false || rule.actions?.[0]?.type !== "forward")
    .map(([local]) => `${local}@${domain}`);
  return [
    {
      gate: "G7",
      name: `literal rule ${localPart}@${domain} → Worker${worker ? ` ${worker}` : ""}`,
      status: toWorker ? "pass" : "fail",
      detail: project ? `enabled=${project.enabled !== false} ${JSON.stringify(project.actions)}` : "missing",
    },
    {
      gate: "G7",
      name: "RFC 2142 forwards (postmaster@, abuse@)",
      status: missingForwards.length === 0 ? "pass" : "fail",
      detail: missingForwards.length === 0 ? "both forward" : `missing or not forwarding: ${missingForwards.join(", ")}`,
    },
    {
      gate: "G7",
      name: `no other rule on ${domain}`,
      status: others.length === 0 ? "pass" : "fail",
      detail: others.length === 0 ? "none" : others.map((r) => literals(r).join(" ")).join(", "),
    },
  ];
}

export function forwardDestinationFinding(rules: Rule[], domain: string, localPart: string, addresses: DestinationAddress[]): Finding {
  const { rfc2142 } = classifyDomainRules(rules, domain, localPart);
  const wanted = [...new Set(rfc2142.flatMap(([, rule]) => (rule ? targets(rule) : [])).map((t) => t.toLowerCase()))];
  const verified = new Set(addresses.filter((a) => a.verified).map((a) => (a.email ?? "").toLowerCase()));
  const pending = wanted.filter((email) => !verified.has(email));
  return {
    gate: "G0",
    name: "RFC 2142 forward destination verified",
    status: wanted.length > 0 && pending.length === 0 ? "pass" : "fail",
    detail:
      wanted.length === 0
        ? "no forward to check"
        : pending.length === 0
          ? wanted.join(", ")
          : `${pending.join(", ")} not verified: open Cloudflare's verification mail to it and click`,
  };
}

export function txtFromDoh(answer: { Status?: number; Answer?: Array<{ type?: number; data?: string }> }): string[] {
  if (answer.Status === 3) return [];
  if (answer.Status !== 0) throw new Error(`DNS lookup failed with status ${answer.Status}`);
  return (answer.Answer ?? [])
    .filter((record) => record.type === 16 && typeof record.data === "string")
    .map((record) => {
      const data = (record.data as string).trim();
      const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
      return chunks.length > 0 ? chunks.join("") : data;
    });
}

const normalizeDmarc = (record: string) => record.replace(/\s+/g, " ").replace(/\s*;\s*/g, "; ").replace(/;\s*$/, "").trim();

export function dmarcFinding(name: string, txt: string[], expected?: string): Finding {
  const records = txt.filter((t) => /^v=DMARC1\s*(;|$)/i.test(t.trim()));
  const finding = (status: Finding["status"], detail: string): Finding => ({ gate: "G0", name: `one DMARC record at ${name} (public DNS)`, status, detail });
  if (records.length === 0) return finding("fail", "none: inboundMailDmarc (or dnsDmarc) unset, or DNS has not propagated");
  if (records.length > 1) return finding("fail", `${records.length} records, so receivers apply none: ${records.join(" | ")}`);
  if (expected !== undefined && normalizeDmarc(records[0]) !== normalizeDmarc(expected)) {
    return finding("fail", `${records[0]}; expected ${expected}`);
  }
  return finding("pass", records[0]);
}

export function probeAddress(localPart: string, domain: string): string {
  return `${localPart}+smoke.aaaaaaaaaaaa@${domain}`;
}

export function testMailSteps(localPart: string, domain: string, paused: boolean | undefined): string {
  const expect =
    paused === false
      ? "The Worker is NOT paused: the BFF answers this unknown token with a bounce \"This message could not be delivered: the address is unknown or no longer valid\" (the rule matched; that is a pass too)."
      : "Paused (as on the first promote): NO bounce now; the sending server reports a delay after a few hours (a temporary failure: the Worker answered).";
  return [
    `From your own mailbox (any provider that signs DKIM or passes SPF; Cloudflare refuses mail that does neither), send one plain mail to ${probeAddress(localPart, domain)}, subject "G0 probe", any text.`,
    expect,
    `FAIL: an immediate bounce "Address does not exist" (550 5.1.1) from Cloudflare: no rule matched, subaddressing does not reach the subdomain's rule. Stop; take ADR-0138's fallback.`,
    `FIX CONFIG: a bounce "Unknown address: this message was not delivered.": the Worker ran but its ADDRESS_LOCAL_PART or ADDRESS_DOMAIN differ from what you typed.`,
    `Cross-check: Email Routing → Activity log lists the message to ${probeAddress(localPart, domain)} as handled by the rule ${localPart}@${domain} (status Error while paused, the Worker threw).`,
  ].join(" ");
}

async function publicDns(name: string, type: "MX" | "TXT"): Promise<Parameters<typeof mxHostsFromDoh>[0]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`DNS over HTTPS for ${name} answered ${response.status}`);
  return (await response.json()) as Parameters<typeof mxHostsFromDoh>[0];
}

const publicMx = async (name: string) => mxHostsFromDoh(await publicDns(name, "MX"));
const publicTxt = async (name: string) => txtFromDoh(await publicDns(name, "TXT"));

export interface G0Io {
  cloudflareApi: (path: string) => Promise<unknown>;
  env: (name: string) => string;
  mx?: (name: string) => Promise<string[]>;
  txt?: (name: string) => Promise<string[]>;
}

export async function g0Findings(io: G0Io): Promise<Finding[]> {
  const zoneId = io.env("INBOUND_MAIL_ZONE_ID");
  const domain = host(io.env("INBOUND_MAIL_DOMAIN"));
  const localPart = localPartFromEnv();
  const worker = process.env.INBOUND_MAIL_WORKER?.trim() || undefined;
  const mx = io.mx ?? publicMx;

  const zone = (await io.cloudflareApi(`/zones/${zoneId}`)) as { name?: string };
  const apex = host(zone.name ?? "");
  const findings: Finding[] = [receivingMxFinding(domain, await mx(domain))];
  findings.push(
    apex === domain
      ? { gate: "G0", name: "apex", status: "info", detail: `${domain} is the zone's apex: the dedicated-domain fallback, nothing else to keep` }
      : apexMxFinding(apex, await mx(apex), expectedApexMx(process.env.INBOUND_MAIL_APEX_MX)),
  );

  const settings = (await io.cloudflareApi(`/zones/${zoneId}/email/routing`)) as RoutingSettings;
  findings.push(zoneRoutingFinding(settings), subaddressFinding(settings));
  const rules = (await io.cloudflareApi(`/zones/${zoneId}/email/routing/rules?per_page=50`)) as Rule[];
  findings.push(...ruleFindings(rules, domain, localPart, worker));
  const dmarcName = `_dmarc.${apex}`;
  findings.push(dmarcFinding(dmarcName, await (io.txt ?? publicTxt)(dmarcName), process.env.INBOUND_MAIL_DMARC?.trim() || undefined));

  let paused: boolean | undefined;
  const account = process.env.INBOUND_MAIL_ACCOUNT_ID?.trim();
  if (account) {
    const addresses = (await io.cloudflareApi(`/accounts/${account}/email/routing/addresses?per_page=50`)) as DestinationAddress[];
    findings.push(forwardDestinationFinding(rules, domain, localPart, addresses));
  }
  if (account && worker) {
    const script = (await io.cloudflareApi(`/accounts/${account}/workers/scripts/${worker}/settings`)) as {
      bindings?: Array<{ name: string; text?: string }>;
    };
    const text = script.bindings?.find((b) => b.name === "PAUSED")?.text;
    paused = text === undefined ? undefined : text === "true";
  }
  findings.push({ gate: "G0", name: "the test mail", status: "manual", detail: testMailSteps(localPart, domain, paused) });
  return findings;
}
