import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:tls";
import { gzipSync } from "node:zlib";
import { createSigner, httpbis } from "http-message-signatures";
import { serializeDictionary } from "structured-headers";
import { g0Findings, localPartFromEnv, ruleFindings, subaddressFinding, zoneRoutingFinding } from "./inbound-mail-g0";
import type { Finding, RoutingSettings, Rule } from "./inbound-mail-g0";

const CONTRACT = JSON.parse(
  readFileSync(join(__dirname, "../../../contracts/inbound-mail-contract.json"), "utf8"),
) as {
  path: string;
  envelopeToHeader: string;
  envelopeFromHeader: string;
  verdictHeader: string;
  verdictReject: string;
  contentType: string;
  maxRawMessageBytes: number;
  edgeMaxBodyBytes: number;
  signedComponents: string[];
};

const MiB = 1024 * 1024;

export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export interface Attachment {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export function buildMessage(args: { to: string; subject: string; text: string; attachments?: Attachment[] }): Buffer {
  const boundary = `smoke-${randomBytes(12).toString("hex")}`;
  const lines = [
    "From: The agent smoke test <smoke@example.invalid>",
    `To: ${args.to}`,
    `Subject: [smoke] ${args.subject}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@smoke.invalid>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    args.text,
  ];
  for (const attachment of args.attachments ?? []) {
    const encoded = Buffer.from(attachment.bytes).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      "",
      encoded,
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"));
}

export function messageOfSize(to: string, subject: string, size: number): Buffer {
  const empty = buildMessage({ to, subject, text: "Size probe.", attachments: [] });
  let raw = Math.max(0, Math.floor(((size - empty.byteLength - 400) * 3 * 76) / (4 * 78)));
  for (;;) {
    const attachment = { name: "filler.bin", contentType: "application/octet-stream", bytes: randomBytes(raw) };
    const probe = buildMessage({ to, subject, text: "Size probe.", attachments: [attachment] });
    const missing = size - probe.byteLength;
    if (missing >= 0) {
      return buildMessage({ to, subject, text: `Size probe.${" ".repeat(missing)}`, attachments: [attachment] });
    }
    raw -= Math.ceil(-missing * 0.75) + 3;
  }
}

export async function signedHeaders(args: {
  url: string;
  body: Uint8Array;
  keyId: string;
  secret: string;
  envelopeTo: string;
  envelopeFrom: string;
  created?: Date;
}): Promise<Record<string, string>> {
  const created = args.created ?? new Date();
  const headers: Record<string, string> = {
    "content-type": CONTRACT.contentType,
    "content-digest": serializeDictionary({ "sha-256": createHash("sha256").update(args.body).digest() }),
    "content-length": String(args.body.byteLength),
    [CONTRACT.envelopeToHeader]: args.envelopeTo,
    [CONTRACT.envelopeFromHeader]: args.envelopeFrom,
  };
  const signed = await httpbis.signMessage(
    {
      key: createSigner(Buffer.from(args.secret, "base64"), "hmac-sha256", args.keyId),
      fields: CONTRACT.signedComponents,
      params: ["created", "expires", "keyid", "alg"],
      paramValues: { created, expires: new Date(created.getTime() + 300_000) },
    },
    { method: "POST", url: args.url, headers },
  );
  return Object.fromEntries(Object.entries(signed.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
}

export interface DkimVerdict {
  hasResults: boolean;
  dkimPass: boolean;
  alignedDkimPass: boolean;
  dmarcPass: boolean;
}

const SECOND_LEVEL = new Set(["ac", "co", "com", "edu", "gov", "gv", "net", "or", "org"]);

export function organizationalDomain(domain: string): string {
  const labels = domain.toLowerCase().replace(/\.$/, "").split(".");
  const take = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function headerFields(raw: string): Array<[string, string]> {
  const head = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const fields: Array<[string, string]> = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length > 0) fields[fields.length - 1][1] += ` ${line.trim()}`;
    else {
      const colon = line.indexOf(":");
      if (colon > 0) fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  return fields;
}

export function dkimVerdict(raw: string): DkimVerdict {
  const fields = headerFields(raw);
  const results = fields.find(([name]) => name === "authentication-results")?.[1];
  const from = fields.find(([name]) => name === "from")?.[1] ?? "";
  const fromDomain = /@([A-Za-z0-9.-]+)/.exec(from)?.[1];
  if (results === undefined) return { hasResults: false, dkimPass: false, alignedDkimPass: false, dmarcPass: false };
  const passes = results
    .split(";")
    .map((part) => part.trim())
    .filter((part) => /^dkim\s*=\s*pass\b/i.test(part));
  const signers = passes
    .map((part) => /header\.d\s*=\s*([A-Za-z0-9.-]+)/i.exec(part)?.[1] ?? /header\.i\s*=\s*[^@\s]*@([A-Za-z0-9.-]+)/i.exec(part)?.[1])
    .filter((d): d is string => d !== undefined);
  const aligned =
    fromDomain !== undefined && signers.some((d) => organizationalDomain(d) === organizationalDomain(fromDomain));
  return {
    hasResults: true,
    dkimPass: passes.length > 0,
    alignedDkimPass: aligned,
    dmarcPass: /(?:^|;)\s*dmarc\s*=\s*pass\b/i.test(results),
  };
}

export function splitMbox(text: string): string[] {
  return text
    .split(/^From .*\r?\n/m)
    .filter((part) => part.trim() !== "")
    .map((part) => part.replace(/^>(>*From )/gm, "$1"));
}

interface Check {
  gate: string;
  name: string;
  status: "pass" | "fail" | "manual" | "info";
  detail: string;
}

const checks: Check[] = [];

function record(gate: string, name: string, status: Check["status"], detail: string): void {
  checks.push({ gate, name, status, detail });
  const mark = { pass: "PASS  ", fail: "FAIL  ", manual: "MANUAL", info: "INFO  " }[status];
  console.log(`${mark} ${gate.padEnd(3)} ${name}: ${detail}`);
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set (see the header of scripts/inbound-mail-smoke.ts).`);
    process.exit(2);
  }
  return value;
}

const MANUAL: Array<[string, string]> = [
  [
    "G0",
    "Subaddressing on the subdomain (ADR-0138's one unproven assumption), before anything else: one call, " +
      "PATCH /zones/INBOUND_MAIL_ZONE_ID/email/routing {\"support_subaddress\":true} (the provider cannot set it; the runbook's §7), then " +
      "`g0` (both MX sets, support_subaddress, the rules, the forwards' verified destination, one DMARC record, and this test mail spelled out). With the stack still paused, send one plain mail to " +
      "INBOUND_MAIL_LOCAL_PART+smoke.aaaaaaaaaaaa@INBOUND_MAIL_DOMAIN: the sender must see a TEMPORARY failure " +
      "(the Worker's pause), not 'Address does not exist' (no rule matched). Email Routing → Activity log must show " +
      "the rule INBOUND_MAIL_LOCAL_PART@INBOUND_MAIL_DOMAIN matched. A permanent 5xx here means subaddressing does not " +
      "reach the subdomain's rule: stop, and take the fallback (a dedicated mail domain with an apex catch-all, ADR-0138).",
  ],
  [
    "G1",
    "From a mailbox of a domain that signs DKIM (and whose DMARC is published), send a mail with one PDF to " +
      "INBOUND_MAIL_TEST_ADDRESS, after G4's unpause: the inbound-mail entitlement is on for the test office " +
      "only, so no customer office has an address yet. Expect it held in the test project within a minute, with a verified sender trust " +
      "(`*_verified`) and the signed " +
      "headers listed in its details: DKIM survives Cloudflare into message.raw.",
  ],
  [
    "G2",
    "Cloudflare dashboard: create a throwaway Worker whose email handler is `throw new Error('gate')`, and a " +
      "literal rule for INBOUND_MAIL_TEST_ADDRESS itself → that Worker (a literal rule for a subaddress takes " +
      "precedence over the base rule). Send a mail to the test address; the sending server must report a temporary " +
      "failure (4xx) and keep retrying. Delete that rule, so the address falls back to the real rule; the retry " +
      "must arrive in the test project. Delete the throwaway Worker. Record the date.",
  ],
  [
    "G3",
    "Send a ~24 MiB mail through real SMTP (accepted) and a ~26 MiB one (refused by Cloudflare at SMTP time). " +
      "`signed --run` covers the BFF's and the edge's limits and a truncated body.",
  ],
  [
    "G4",
    "With inboundMailPaused: true promoted: `signed --run --expect-paused` (the BFF answers 503) and one real " +
      "mail (the sender reports a temporary failure). Set it false, promote, and the retried mail arrives.",
  ],
  [
    "G5",
    "Send one 25 MiB mail through real SMTP. Workers → the script → Metrics: CPU time and errors for that " +
      "invocation. An `exceededCpu` or memory error blocks launch; there is no fallback (DECISION D19).",
  ],
  [
    "G6",
    "`malware --run` posts EICAR and a limit-exceeding archive. Among the held mail the EICAR part must be " +
      "'infected' and the archive part 'failed', never 'clean'; neither may be filed; the original download of " +
      "the EICAR mail must be refused. Stop freshclam for 49 h on a staging clamd (or point it at an old " +
      "database) and confirm a scan answers 'failed' (stale-signatures). Known gap: clamd scans a zip member " +
      "only up to MaxFileSize and answers OK without an alert (ADR-0157).",
  ],
  [
    "G7",
    "`cloudflare` checks it: the one literal rule INBOUND_MAIL_LOCAL_PART@INBOUND_MAIL_DOMAIN → the Worker, the " +
      "RFC 2142 forwards postmaster@ and abuse@ (Pulumi's, to inboundMailOperatorAddress), and no other rule on the receiving domain.",
  ],
  ["G8", "After any COMPATIBILITY_DATE bump (platform/inbound-mail.ts): G1 and G2 again."],
  [
    "G9",
    "Export a pilot office's real project mail (an Outlook archive as .eml or mbox) and run `dkim-share` on it. " +
      "Record the aligned share: it is the share of senders whose mail will carry a verified trust label and can be followed.",
  ],
];

function plan(): void {
  console.log("Project mail launch gates (DECISION §8). Automated parts: `g0`, `cloudflare`, `signed`, `malware`, `dkim-share`.\n");
  for (const [gate, text] of MANUAL) record(gate, "steps", "manual", text);
}

async function cloudflareApi(path: string): Promise<unknown> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}` },
  });
  const body = (await response.json()) as { success?: boolean; result?: unknown; errors?: unknown };
  if (!response.ok || body.success === false) {
    throw new Error(`GET ${path} answered ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

function recordAll(findings: Finding[]): void {
  for (const f of findings) record(f.gate, f.name, f.status, f.detail);
}

async function checkCloudflare(): Promise<void> {
  const zone = env("INBOUND_MAIL_ZONE_ID");
  const domain = env("INBOUND_MAIL_DOMAIN").toLowerCase();
  const localPart = localPartFromEnv();
  const worker = env("INBOUND_MAIL_WORKER");
  const account = env("INBOUND_MAIL_ACCOUNT_ID");

  const routing = (await cloudflareApi(`/zones/${zone}/email/routing`)) as RoutingSettings;
  recordAll([zoneRoutingFinding(routing), subaddressFinding(routing)]);
  const rules = (await cloudflareApi(`/zones/${zone}/email/routing/rules?per_page=50`)) as Rule[];
  recordAll(ruleFindings(rules, domain, localPart, worker));

  const mx = (await cloudflareApi(`/zones/${zone}/dns_records?type=MX&name=${domain}`)) as Array<{ content: string }>;
  const foreign = mx.filter((r) => !/\.mx\.cloudflare\.net\.?$/i.test(r.content));
  record("G0", `MX of ${domain}`, mx.length > 0 && foreign.length === 0 ? "pass" : "fail", mx.map((r) => r.content).join(", ") || "none");

  const settings = (await cloudflareApi(`/accounts/${account}/workers/scripts/${worker}/settings`)) as {
    compatibility_date?: string;
    observability?: { enabled?: boolean; logs?: { enabled?: boolean; invocation_logs?: boolean } };
    bindings?: Array<{ name: string; type: string; text?: string }>;
  };
  const invocationLogs = settings.observability?.enabled === true && settings.observability.logs?.invocation_logs !== false;
  record("G0", "Workers invocation logs off", invocationLogs ? "fail" : "pass", JSON.stringify(settings.observability));
  record("G8", "compatibility date", "info", `${settings.compatibility_date}; after a bump, G1 and G2 again`);
  const bindings = new Map((settings.bindings ?? []).map((b) => [b.name, b]));
  const expected = [
    ["BFF_URL", "plain_text"],
    ["SIGNING_KEY_ID", "plain_text"],
    ["SIGNING_KEY", "secret_text"],
    ["PAUSED", "plain_text"],
    ["ADDRESS_DOMAIN", "plain_text"],
    ["ADDRESS_LOCAL_PART", "plain_text"],
    ["LANDING_URL", "plain_text"],
  ];
  const wrong = expected.filter(([name, type]) => bindings.get(name)?.type !== type).map(([name]) => name);
  record("G0", "Worker bindings", wrong.length === 0 ? "pass" : "fail", wrong.length === 0 ? `all ${expected.length}, key secret` : `wrong or missing: ${wrong.join(", ")}`);
  const paused = bindings.get("PAUSED")?.text;
  record("G4", "Worker pause", "info", `PAUSED=${paused ?? "?"}`);
}

async function post(headers: Record<string, string>, body: Uint8Array): Promise<Response> {
  const url = new URL(CONTRACT.path, env("INBOUND_MAIL_APP_ORIGIN")).href;
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "content-length"));
  return fetch(url, { method: "POST", headers: sent, body: new Uint8Array(body), redirect: "manual", signal: AbortSignal.timeout(120_000) });
}

async function signedPost(body: Uint8Array, options: { keyId?: string; secret?: string } = {}): Promise<Response> {
  const url = new URL(CONTRACT.path, env("INBOUND_MAIL_APP_ORIGIN")).href;
  const headers = await signedHeaders({
    url,
    body,
    keyId: options.keyId ?? env("INBOUND_MAIL_KEY_ID"),
    secret: options.secret ?? env("INBOUND_MAIL_SIGNING_KEY"),
    envelopeTo: env("INBOUND_MAIL_TEST_ADDRESS"),
    envelopeFrom: "smoke@example.invalid",
  });
  return post(headers, body);
}

async function reason(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const verdict = response.headers.get(CONTRACT.verdictHeader);
  return `${response.status}${verdict ? ` ${CONTRACT.verdictHeader}: ${verdict}` : ""} ${text.slice(0, 160)}`;
}

async function truncatedPost(body: Buffer): Promise<string> {
  const url = new URL(CONTRACT.path, env("INBOUND_MAIL_APP_ORIGIN"));
  const headers = await signedHeaders({
    url: url.href,
    body,
    keyId: env("INBOUND_MAIL_KEY_ID"),
    secret: env("INBOUND_MAIL_SIGNING_KEY"),
    envelopeTo: env("INBOUND_MAIL_TEST_ADDRESS"),
    envelopeFrom: "smoke@example.invalid",
  });
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname }, () => {
      const head = [`POST ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, "Connection: close"];
      for (const [name, value] of Object.entries(headers)) head.push(`${name}: ${value}`);
      socket.write(`${head.join("\r\n")}\r\n\r\n`);
      socket.write(body.subarray(0, body.byteLength - 4096));
      socket.end();
    });
    let answer = "";
    socket.setTimeout(150_000, () => {
      socket.destroy();
      resolve("no answer within 150 s (the edge held the short request)");
    });
    socket.on("data", (chunk) => (answer += chunk.toString("latin1")));
    socket.on("end", () => resolve(answer.split("\r\n")[0] || "connection closed without an answer"));
    socket.on("error", reject);
  });
}

async function signedGates(expectPaused: boolean): Promise<void> {
  const to = env("INBOUND_MAIL_TEST_ADDRESS");
  const small = buildMessage({ to, subject: "wiring", text: "A signed probe from scripts/inbound-mail-smoke.ts." });

  const unsigned = await post({ "content-type": CONTRACT.contentType }, small);
  record("G3", "unsigned request refused", unsigned.status === 401 ? "pass" : "fail", await reason(unsigned));

  const unknownKey = await signedPost(small, { keyId: "smoke-unknown-key", secret: randomBytes(32).toString("base64") });
  record("G3", "unknown key refused", unknownKey.status === 401 ? "pass" : "fail", await reason(unknownKey));

  const accepted = await signedPost(small);
  if (expectPaused) {
    record("G4", "paused: a signed mail is a retry", accepted.status === 503 ? "pass" : "fail", await reason(accepted));
    return;
  }
  record("G3", "a signed small mail is held", accepted.status === 202 ? "pass" : "fail", await reason(accepted));

  const large = messageOfSize(to, "24 MiB", 24 * MiB);
  const largeAnswer = await signedPost(large);
  record("G3", "24 MiB is held", largeAnswer.status === 202 ? "pass" : "fail", await reason(largeAnswer));

  const over = messageOfSize(to, "over the cap", CONTRACT.maxRawMessageBytes + 1);
  const overAnswer = await signedPost(over);
  const rejected = overAnswer.status === 413 && overAnswer.headers.get(CONTRACT.verdictHeader) === CONTRACT.verdictReject;
  record("G3", "over 26 MiB is a bounce (413 + reject)", rejected ? "pass" : "fail", await reason(overAnswer));

  const edge = Buffer.alloc(CONTRACT.edgeMaxBodyBytes + 1, 0x20);
  const edgeAnswer = await post({ "content-type": CONTRACT.contentType }, edge);
  const edgeRefused = edgeAnswer.status === 413 && edgeAnswer.headers.get(CONTRACT.verdictHeader) === null;
  record("G3", "over the edge ceiling: Envoy's own 413", edgeRefused ? "pass" : "fail", await reason(edgeAnswer));

  const truncated = await truncatedPost(buildMessage({ to, subject: "truncated", text: "x".repeat(64 * 1024) }));
  record("G3", "a truncated body is never accepted", /^HTTP\/1\.1 2/.test(truncated) ? "fail" : "pass", truncated);
}

async function malwareGates(): Promise<void> {
  const to = env("INBOUND_MAIL_TEST_ADDRESS");
  const eicar = buildMessage({
    to,
    subject: "EICAR",
    text: "The attachment is the EICAR test file; the scanner must report it.",
    attachments: [{ name: "eicar.com.txt", contentType: "text/plain", bytes: Buffer.from(EICAR) }],
  });
  const eicarAnswer = await signedPost(eicar);
  record("G6", "EICAR mail is held (for the scanner)", eicarAnswer.status === 202 ? "pass" : "fail", await reason(eicarAnswer));

  const bomb = gzipSync(Buffer.alloc(200 * MiB), { level: 9 });
  const bombMessage = buildMessage({
    to,
    subject: "limit-exceeding archive",
    text: "The attachment decompresses past the scanner's limits; it must never scan clean.",
    attachments: [{ name: "zeros.gz", contentType: "application/gzip", bytes: bomb }],
  });
  const bombAnswer = await signedPost(bombMessage);
  record("G6", "limit-exceeding archive is held", bombAnswer.status === 202 ? "pass" : "fail", await reason(bombAnswer));
  record("G6", "verdicts", "manual", MANUAL.find(([gate]) => gate === "G6")?.[1] ?? "");
}

function messagesIn(paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (statSync(path).isDirectory()) {
      out.push(...messagesIn(readdirSync(path).map((entry) => join(path, entry))));
    } else if (/\.mbox$/i.test(path)) {
      out.push(...splitMbox(readFileSync(path, "latin1")));
    } else if (/\.eml$/i.test(path)) {
      out.push(readFileSync(path, "latin1"));
    }
  }
  return out;
}

function dkimShare(paths: string[]): void {
  const verdicts = messagesIn(paths).map(dkimVerdict);
  const count = (pick: (v: DkimVerdict) => boolean) => verdicts.filter(pick).length;
  const total = verdicts.length;
  const withResults = count((v) => v.hasResults);
  const share = (n: number) => (withResults === 0 ? "n/a" : `${((100 * n) / withResults).toFixed(1)} %`);
  record("G9", "messages", "info", `${total} read, ${withResults} with Authentication-Results`);
  record("G9", "dkim=pass", "info", `${count((v) => v.dkimPass)} (${share(count((v) => v.dkimPass))})`);
  record("G9", "aligned dkim=pass", "info", `${count((v) => v.alignedDkimPass)} (${share(count((v) => v.alignedDkimPass))})`);
  record("G9", "dmarc=pass", "info", `${count((v) => v.dmarcPass)} (${share(count((v) => v.dmarcPass))})`);
}

async function main(argv: string[]): Promise<void> {
  const [command = "plan", ...rest] = argv;
  const run = rest.includes("--run");
  const sends = command === "signed" || command === "malware";
  if (sends && !run) {
    console.log(`'${command}' posts signed messages to INBOUND_MAIL_APP_ORIGIN. Add --run to send them.\n`);
    plan();
    return;
  }
  switch (command) {
    case "plan":
      plan();
      break;
    case "g0":
      recordAll(await g0Findings({ cloudflareApi, env }));
      break;
    case "cloudflare":
      await checkCloudflare();
      break;
    case "signed":
      await signedGates(rest.includes("--expect-paused"));
      break;
    case "malware":
      await malwareGates();
      break;
    case "dkim-share": {
      const paths = rest.filter((arg) => !arg.startsWith("--"));
      if (paths.length === 0) {
        console.error("dkim-share needs one or more .eml files, .mbox files or directories.");
        process.exit(2);
      }
      dkimShare(paths);
      break;
    }
    default:
      console.error(`Unknown command '${command}'. Commands: plan, g0, cloudflare, signed, malware, dkim-share.`);
      process.exit(2);
  }
  if (checks.some((check) => check.status === "fail")) process.exit(1);
}

if (process.argv[1]?.endsWith("inbound-mail-smoke.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
