import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { appOrigin } from "../app/config";
import type { MailZone } from "./email-routing";

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
 * Subaddressing is a dashboard setting this program cannot set (the provider's
 * only handle on it onboards the zone apex; `email-routing.ts` says why), and
 * whether it applies to a SUBDOMAIN's rules is the one thing ADR-0138 has us
 * prove with a test address before the first unpause. If it does not, the
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
 * ## Cloudflare API token scopes (on `cloudflareApiToken`)
 *
 *   - Account · Workers Scripts · Edit (the Worker)
 *   - Zone · Email Routing Rules · Edit (the rule), on the inbound zone
 *   - Zone · Zone Settings · Edit (enabling routing, `email/routing/dns`)
 *   - Zone · DNS · Edit (routing adds and locks the domain's MX and SPF
 *     records; the MX guard reads them)
 *   - Zone · Zone · Read (`getZone`: the zone check and the account id)
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
    return { zone, rule };
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
      observability: { enabled: false },
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

  return { zone, script, rule };
}
