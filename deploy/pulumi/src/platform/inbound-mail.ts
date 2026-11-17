import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { appOrigin } from "../app/config";
import { installMailZoneDmarc, type MailZone } from "./email-routing";
import { installOperatorForwards, operatorAddressStatus, type OperatorForwards } from "./inbound-mail-operator";

export const COMPATIBILITY_DATE = "2026-10-01";

const WORKER_FILE = "inbound-mail-worker.js";

export interface InboundMail {
  zone: MailZone;
  script?: cloudflare.WorkersScript;
  rule: cloudflare.EmailRoutingRule;
  operator: OperatorForwards;
  dmarc?: cloudflare.DnsRecord;
}

export function ruleAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

export function workerScriptName(stack: string): string {
  return `inbound-mail-${stack}`;
}

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
        enabled: false,
        matchers,
        actions: [{ type: "drop" }],
      },
      { ...opts, dependsOn: [zone.routing] },
    );
    return { zone, rule, operator, dmarc };
  }

  const script = new cloudflare.WorkersScript(
    "inbound-mail-worker",
    {
      accountId: zone.accountId,
      scriptName,
      mainModule: WORKER_FILE,
      content: readFileSync(join(__dirname, WORKER_FILE), "utf8"),
      compatibilityDate: COMPATIBILITY_DATE,
      observability: { enabled: true, logs: { enabled: true, invocationLogs: false } },
      bindings: [
        { name: "BFF_URL", type: "plain_text", text: appOrigin(cfg) },
        { name: "SIGNING_KEY_ID", type: "plain_text", text: mail.signingKeyId },
        { name: "SIGNING_KEY", type: "secret_text", text: mail.signingKey },
        { name: "PAUSED", type: "plain_text", text: String(mail.paused) },
        { name: "ADDRESS_DOMAIN", type: "plain_text", text: mail.domain },
        { name: "ADDRESS_LOCAL_PART", type: "plain_text", text: mail.localPart },
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

export interface InboundMailCloudflareOutput {
  zoneId: string;
  accountId: string;
  domain: string;
  localPart: string;
  worker: string | null;
  paused: boolean;
}

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
