/**
 * Gate G0 of project mail (ADR-0138), as one read-only check: does the
 * receiving subdomain route to Cloudflare while the apex keeps its own mail,
 * is subaddressing on, and does the one literal rule hand
 * `<local part>+<anything>@<domain>` to the Worker? Then the exact test mail
 * that proves the last part on the wire, because only a sent mail can.
 *
 *   cd deploy/pulumi
 *   bun scripts/inbound-mail-smoke.ts g0
 *
 * Reads, never writes: public DNS over HTTPS for both MX sets (what a sending
 * server sees, not what the zone file says), and the Cloudflare API for the
 * zone's name, its Email Routing settings and its rules. Inputs are the smoke
 * tool's (`CLOUDFLARE_API_TOKEN`, `INBOUND_MAIL_ZONE_ID`, `INBOUND_MAIL_DOMAIN`,
 * optionally `INBOUND_MAIL_LOCAL_PART`, `INBOUND_MAIL_WORKER`,
 * `INBOUND_MAIL_ACCOUNT_ID`) plus one of its own:
 *
 *   INBOUND_MAIL_APEX_MX   the apex's MX hosts as they must stay, comma-separated
 *                          (`smtp.google.com`), or `none` for an apex that
 *                          receives no mail. Unset: any apex MX passes that is
 *                          not Cloudflare's. `cloudflare` only where the owner
 *                          deliberately onboarded an apex that had no mail of
 *                          its own (the runbook's G0, path a).
 *
 * The runbook that orders it: docs/deployment/project-mail-runbook.md.
 */

import { DEFAULT_INBOUND_MAIL_LOCAL_PART } from "../src/config/inbound-mail";

/** Cloudflare Email Routing's MX hosts (`route1.mx.cloudflare.net` and its siblings). */
const CLOUDFLARE_MX = /\.mx\.cloudflare\.net\.?$/i;

/** What one check found, in the smoke tool's terms. */
export interface Finding {
  gate: string;
  name: string;
  status: "pass" | "fail" | "manual" | "info";
  detail: string;
}

/** A routing rule as `GET /zones/{zone}/email/routing/rules` returns it. */
export interface Rule {
  enabled?: boolean;
  matchers?: Array<{ type?: string; field?: string; value?: string }>;
  actions?: Array<{ type?: string; value?: string[]; values?: string[] }>;
}

/** The Email Routing settings `GET /zones/{zone}/email/routing` returns. */
export interface RoutingSettings {
  enabled?: boolean;
  status?: string;
  name?: string;
  support_subaddress?: boolean;
}

/** The literal addresses RFC 2142 asks every mail domain to answer, forwarded to an operator. */
export const RFC2142_LOCAL_PARTS = ["postmaster", "abuse"] as const;

/** The rule's local part: `INBOUND_MAIL_LOCAL_PART`, else the program's own default. */
export function localPartFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.INBOUND_MAIL_LOCAL_PART?.trim() || DEFAULT_INBOUND_MAIL_LOCAL_PART).toLowerCase();
}

function host(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * MX hosts from a DNS-over-HTTPS JSON answer (`application/dns-json`, as
 * cloudflare-dns.com and dns.google serve it). NXDOMAIN and an empty answer
 * are both no MX. Any other failure status throws: a lookup that failed is not
 * an empty record set.
 */
export function mxHostsFromDoh(answer: { Status?: number; Answer?: Array<{ type?: number; data?: string }> }): string[] {
  if (answer.Status === 3) return [];
  if (answer.Status !== 0) throw new Error(`DNS lookup failed with status ${answer.Status}`);
  return (answer.Answer ?? [])
    .filter((record) => record.type === 15 && typeof record.data === "string")
    .map((record) => host((record.data as string).trim().split(/\s+/).pop() ?? ""))
    .sort();
}

/** G0: the receiving domain's MX are Cloudflare's, and only Cloudflare's. */
export function receivingMxFinding(domain: string, hosts: string[]): Finding {
  const foreign = hosts.filter((h) => !CLOUDFLARE_MX.test(h));
  const ok = hosts.length > 0 && foreign.length === 0;
  const detail =
    hosts.length === 0
      ? "none: Email Routing is not enabled on the subdomain yet (the paused promote enables it), or DNS has not propagated"
      : hosts.join(", ");
  return { gate: "G0", name: `MX of ${domain} (public DNS)`, status: ok ? "pass" : "fail", detail };
}

/** What the apex's MX must be: a host list (`[]`: none), or Cloudflare's after a deliberate onboarding. */
export type ApexExpectation = string[] | "cloudflare";

/**
 * G0: the apex's MX are unchanged. Cloudflare's MX on the apex mean someone
 * onboarded the apex to Email Routing, which takes the company's mail away
 * from its provider: a fail, unless the owner chose exactly that
 * (`"cloudflare"`). With a host list the set must match it exactly (`[]` for
 * an apex that receives no mail).
 */
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

/** `INBOUND_MAIL_APEX_MX`: unset is no expectation, `none` the empty set, `cloudflare` a deliberate onboarding. */
export function expectedApexMx(raw: string | undefined): ApexExpectation | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.toLowerCase() === "none") return [];
  if (value.toLowerCase() === "cloudflare") return "cloudflare";
  return value.split(",").map(host).filter((h) => h !== "");
}

/**
 * The zone's own routing state. Informational: with routing enabled on a
 * subdomain only, what this object reports for the apex is undocumented, and
 * the MX and the test mail are the proof either way.
 */
export function zoneRoutingFinding(settings: RoutingSettings): Finding {
  return {
    gate: "G0",
    name: "Email Routing on the zone (the apex's state)",
    status: "info",
    detail: `enabled=${settings.enabled} status=${settings.status}; the apex need not be onboarded`,
  };
}

/** G0: subaddressing, which makes `<local part>+<detail>@` reach the rule for `<local part>@`. */
export function subaddressFinding(settings: RoutingSettings): Finding {
  const on = settings.support_subaddress === true;
  return {
    gate: "G0",
    name: "subaddressing on the zone",
    status: on ? "pass" : "fail",
    detail: `support_subaddress=${settings.support_subaddress}${on ? "" : ": Email Routing → Settings → Subaddressing"}`,
  };
}

function literals(rule: Rule): string[] {
  return (rule.matchers ?? []).filter((m) => m.type === "literal" && m.value).map((m) => (m.value as string).toLowerCase());
}

function targets(rule: Rule): string[] {
  const action = rule.actions?.[0];
  return [...(action?.value ?? []), ...(action?.values ?? [])];
}

/**
 * The rules on the receiving domain, sorted: the project rule
 * `<localPart>@<domain>`, the RFC 2142 forwards, and whatever else is there
 * (which G7 refuses: nobody else receives mail on this domain).
 */
export function classifyDomainRules(rules: Rule[], domain: string, localPart: string) {
  const onDomain = rules.filter((r) => literals(r).some((v) => v.endsWith(`@${domain}`)));
  const at = (local: string) => onDomain.find((r) => literals(r).includes(`${local}@${domain}`));
  const project = at(localPart);
  const rfc2142 = RFC2142_LOCAL_PARTS.map((local) => [local, at(local)] as const);
  const known = new Set<Rule | undefined>([project, ...rfc2142.map(([, rule]) => rule)]);
  return { project, rfc2142, others: onDomain.filter((r) => !known.has(r)) };
}

/** G0 and G7 over the zone's rules. `worker` (the script name) is checked when given. */
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

/** The probe address G0 mails: project-shaped, so the Worker answers it, and of no project. */
export function probeAddress(localPart: string, domain: string): string {
  return `${localPart}+smoke.aaaaaaaaaaaa@${domain}`;
}

/** The mail a person sends for G0, and what each answer means. `paused` from the Worker's binding, when known. */
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

/** Public DNS over HTTPS: what a sending server sees. */
async function publicMx(name: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=MX`;
  const response = await fetch(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`DNS over HTTPS for ${name} answered ${response.status}`);
  return mxHostsFromDoh((await response.json()) as Parameters<typeof mxHostsFromDoh>[0]);
}

/** What `g0` needs from the smoke tool: its Cloudflare GET and its required-env reader. */
export interface G0Io {
  cloudflareApi: (path: string) => Promise<unknown>;
  env: (name: string) => string;
  mx?: (name: string) => Promise<string[]>;
}

/** Every G0 finding, the test mail last. */
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

  let paused: boolean | undefined;
  const account = process.env.INBOUND_MAIL_ACCOUNT_ID?.trim();
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
