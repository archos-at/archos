import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { appOrigin } from "../app/config";
import { installMailZoneDmarc, type MailZone } from "./email-routing";
import { installOperatorForwards, operatorAddressStatus, type OperatorForwards } from "./inbound-mail-operator";

/**
 * Project mail (ADR-0138): ONE literal routing rule on `inboundMailDomain`,
 * `<inboundMailLocalPart>@<domain>` (`project@inbox.example.org`), handing its mail
 * to one Email Worker (`inbound-mail-worker.js`), which signs project
 * addresses' mail for the BFF and refuses the rest.
 *
 * Email Routing on the domain (the provider, the guards, the enablement) is
 * `installInboundMailZone` in `email-routing.ts`. Nothing here runs in the
 * cluster; the in-cluster parts are the frontend's env (`app/config.ts`) and
 * the signed route at the edge (`app/httproutes.ts`, `SIGNED_INTERNAL_ROUTE`).
 *
 * ## One rule, and subaddressing
 *
 * A project's address is `project+<slug>.<token>@inbox.example.org`. With the
 * zone's subaddressing setting on, Cloudflare matches `project+<anything>@…`
 * against the rule for `project@…` and keeps the `+detail` in `message.to`,
 * where the Worker reads the token. So one rule serves every project, and
 * minting an address needs no Cloudflare call and no credential in the BFF.
 *
 * Subaddressing is a zone setting this program cannot set (the provider's
 * only handle on it onboards the zone apex; `email-routing.ts` says why, and
 * which API call `deploy.yml` makes instead, after `pulumi up`), and whether it applies to a
 * SUBDOMAIN's rules is the one thing ADR-0138 has us prove with a test address
 * before the first unpause. If it does not, the
 * documented fallback is a dedicated mail domain with an apex catch-all.
 *
 * ## Why a subdomain, and not the product's apex
 *
 *   - The apex's MX belongs to the company's mail provider (Google
 *     Workspace), and Email Routing needs exclusive control of the MX of the
 *     domain it routes.
 *   - Cloudflare's catch-all exists only for a zone's apex ("Catch-all rules
 *     are only available for the apex domain", developers.cloudflare.com
 *     /email-service/configuration/subdomains/, last updated 2026-10-15), so a
 *     subdomain gets literal rules only.
 *   - A literal rule per project does not scale: 200 routing rules per domain,
 *     and the BFF would need a Cloudflare credential to mint an address.
 *
 * ## On, managed off, paused
 *
 *   - **On** (`inboundMailDomain` set): the Worker, and the rule enabled and
 *     pointing at it.
 *   - **Managed off** (`inboundMailEnabled: false`): the rule is updated in
 *     place to disabled, so no rule matches and Cloudflare refuses the address
 *     at SMTP time ("Address does not exist"); the sender sees a bounce,
 *     rather than Drop, which accepts and discards and so loses mail silently.
 *     Pulumi then deletes the Worker: deletions run after every update in a
 *     `pulumi up`, so the rule stops naming the Worker before the Worker is
 *     gone.
 *   - **Paused** (`inboundMailPaused`): the Worker answers every project
 *     address with a temporary failure before reading the message, and the
 *     BFF answers 503. Senders retry for days; the first promote with a domain
 *     is paused, and launch gates G0–G9 run before the unpause.
 *
 * ## One stack per inbound zone
 *
 * Email Routing's enablement and its subaddressing are zone-level. `loadConfig`
 * ties project mail on the app zone to the stack that owns the zone
 * (`dnsZoneBaseline`); `stack-files.spec.ts` checks the committed stacks.
 *
 * ## Secrets
 *
 * The signing key is a `secret_text` binding: a plain one is readable by
 * anyone with Workers read access to the account. A binding edited in the
 * dashboard is restored from state by the next `up` (and not repaired by a
 * `refresh`), so the key is rotated only through `inboundMailSigningKeys` and
 * `inboundMailSigningKeyId`, never in the dashboard.
 *
 * ## Privacy at Cloudflare
 *
 * Workers observability is OFF and said so: Workers Logs would keep a record
 * of every delivery at Cloudflare, beyond the Email Routing activity log the
 * privacy notice names.
 *
 * ## Beside the rule: the RFC 2142 forwards and DMARC
 *
 * `postmaster@` and `abuse@` forward to `inboundMailOperatorAddress`
 * (`inbound-mail-operator.ts`), and `inboundMailDmarc`, when set, is the
 * zone apex's `_dmarc` record (`email-routing.ts`). Both are declared whenever
 * the domain is set, switched off included.
 *
 * ## Cloudflare API token scopes (on `cloudflareApiToken`)
 *
 * An account-owned token; the account id comes from `getZone`, never config.
 * On the mail zone (prod: `archos.tech`):
 *
 *   - Zone · Zone · Read (`getZone`: the zone check and the account id)
 *   - Zone · Zone Settings · Edit (enabling routing, `email/routing/dns`; the
 *     subaddressing call `deploy.yml` makes after `pulumi up`, `email-routing.ts`)
 *   - Zone · DNS · Edit (routing adds and locks the domain's MX and SPF
 *     records; the MX guard reads them; the DMARC record and its guard)
 *   - Zone · Email Routing Rules · Edit (the project rule and the two forwards)
 *
 * On the account:
 *
 *   - Account · Workers Scripts · Edit (the Worker)
 *   - Account · Email Routing Addresses · Edit (the operator's destination address)
 *
 * The same token carries the DNS block's scopes on the zones it manages.
 */

/**
 * Runtime semantics the Worker was written against. Bump deliberately, and
 * re-run gates G1 and G2 after (G8): that a thrown error is a temporary SMTP
 * failure is platform behaviour Cloudflare does not document.
 * `inbound-mail.spec.ts` fails once it is a year old, to force that decision.
 */
export const COMPATIBILITY_DATE = "2026-10-01";

/** The Worker module, uploaded verbatim (no bundler: it has no imports). */
const WORKER_FILE = "inbound-mail-worker.js";

export interface InboundMail {
  zone: MailZone;
  /** Absent while switched off. */
  script?: cloudflare.WorkersScript;
  /** The one literal rule, `<localPart>@<domain>`. */
  rule: cloudflare.EmailRoutingRule;
  /** `postmaster@` and `abuse@`, forwarded to the operator. */
  operator: OperatorForwards;
  /** `_dmarc.<zone apex>`, while `inboundMailDmarc` is set. */
  dmarc?: cloudflare.DnsRecord;
}

/** The rule's address: the base every project address is a subaddress of. */
export function ruleAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

/** The Worker's script name. Per stack, because scripts are per ACCOUNT and stacks may share one. */
export function workerScriptName(stack: string): string {
  return `inbound-mail-${stack}`;
}

/**
 * Project mail on `zone` (from `installInboundMailZone`), which is undefined
 * exactly when no domain is set.
 */
export function installInboundMail(cfg: DeployConfig, zone: MailZone | undefined): InboundMail | undefined {
  const mail = cfg.inboundMail;
  if (!mail.configured || zone === undefined) return undefined;
  const opts = { provider: zone.provider };
  const scriptName = workerScriptName(pulumi.getStack());

  const matchers = [{ type: "literal", field: "to", value: ruleAddress(mail.localPart, mail.domain) }];
  const operator = installOperatorForwards(cfg, zone);
  const dmarc = installMailZoneDmarc(cfg, zone);

  if (!mail.enabled) {
    const rule = new cloudflare.EmailRoutingRule(
      "inbound-mail-rule",
      {
        zoneId: zone.zoneId,
        name: "Project mail (switched off)",
        // Disabled, not Drop: no rule then matches, and Cloudflare refuses the
        // address at SMTP time. The action is required by the API and inert
        // while disabled; it no longer names the Worker, which this `up` deletes.
        enabled: false,
        matchers,
        actions: [{ type: "drop" }],
      },
      { ...opts, dependsOn: [zone.routing] },
    );
    return { zone, rule, operator, dmarc };
  }

  // `zone.accountId` comes out of the guarded zone lookup, so the Worker is
  // not registered unless the zone and MX guards passed.
  const script = new cloudflare.WorkersScript(
    "inbound-mail-worker",
    {
      accountId: zone.accountId,
      scriptName,
      mainModule: WORKER_FILE,
      content: readFileSync(join(__dirname, WORKER_FILE), "utf8"),
      compatibilityDate: COMPATIBILITY_DATE,
      // Workers Logs: the Worker's own one line per delivery (`report` in the
      // Worker), nothing else. Invocation logs stay off, because they record
      // the envelope sender and recipient, which are personal data Cloudflare
      // then keeps; the line carries the BFF's request id instead. Off before
      // 2026-11, when two days of refused deliveries left no trace here.
      observability: { enabled: true, logs: { enabled: true, invocationLogs: false } },
      bindings: [
        // The origin the BFF checks `@target-uri` against: one function for both.
        { name: "BFF_URL", type: "plain_text", text: appOrigin(cfg) },
        { name: "SIGNING_KEY_ID", type: "plain_text", text: mail.signingKeyId },
        { name: "SIGNING_KEY", type: "secret_text", text: mail.signingKey },
        { name: "PAUSED", type: "plain_text", text: String(mail.paused) },
        // The address shape, the same values the BFF reads as
        // INBOUND_MAIL_DOMAIN and INBOUND_MAIL_LOCAL_PART.
        { name: "ADDRESS_DOMAIN", type: "plain_text", text: mail.domain },
        { name: "ADDRESS_LOCAL_PART", type: "plain_text", text: mail.localPart },
        // The bounce text's help and privacy links, the BFF's LANDING_URL.
        { name: "LANDING_URL", type: "plain_text", text: cfg.ingress.webOrigin },
      ],
    },
    opts,
  );

  const rule = new cloudflare.EmailRoutingRule(
    "inbound-mail-rule",
    {
      zoneId: zone.zoneId,
      name: `Project mail (${scriptName})`,
      enabled: true,
      matchers,
      actions: [{ type: "worker", values: [script.scriptName] }],
    },
    { ...opts, dependsOn: [script, zone.routing] },
  );

  return { zone, script, rule, operator, dmarc };
}

/**
 * What `deploy.yml` reads after `pulumi up` to switch subaddressing on and run
 * the read-only launch gates (`scripts/inbound-mail-after-deploy.sh`): the zone
 * and account from the guarded lookup, the domain, the local part and the
 * Worker (null while switched off). Null while no domain is set.
 */
export interface InboundMailCloudflareOutput {
  zoneId: string;
  accountId: string;
  domain: string;
  localPart: string;
  worker: string | null;
  paused: boolean;
}

/** The stack outputs of project mail: the Worker (or why none), the operator's address (or why none). */
export function inboundMailOutputs(cfg: DeployConfig, mail: InboundMail | undefined) {
  const unset = pulumi.output("(none: inboundMailDomain unset)");
  const cloudflareOutput: pulumi.Output<InboundMailCloudflareOutput | null> = mail
    ? pulumi
        .all([mail.zone.zoneId, mail.zone.accountId, mail.script?.scriptName ?? pulumi.output(null)])
        .apply(([zoneId, accountId, worker]) => ({
          zoneId,
          accountId,
          domain: cfg.inboundMail.domain,
          localPart: cfg.inboundMail.localPart,
          worker: worker ?? null,
          paused: cfg.inboundMail.paused,
        }))
    : pulumi.output(null);
  return {
    inboundMailCloudflare: cloudflareOutput,
    inboundMailWorker: mail?.script
      ? pulumi.interpolate`${mail.script.scriptName}${cfg.inboundMail.paused ? " (paused)" : ""}`
      : mail
        ? pulumi.output("(none: inboundMailEnabled=false, the routing rule is disabled)")
        : unset,
    inboundMailOperator: mail ? operatorAddressStatus(mail.operator) : unset,
  };
}
