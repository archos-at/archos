import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { RFC2142_LOCAL_PARTS } from "../config/inbound-mail";
import type { MailZone } from "./email-routing";

/**
 * The receiving domain's two other addresses: `postmaster@<domain>` and
 * `abuse@<domain>` (RFC 2142 §2 and §4), each a literal Email Routing rule that
 * forwards to the operator's mailbox (`inboundMailOperatorAddress`), and that
 * mailbox as a destination address of the zone's account.
 *
 * ## The verification click
 *
 * Creating the destination address makes Cloudflare send a verification mail
 * to it, and "all routing rules are automatically disabled until the
 * destination address is validated by the user" (developers.cloudflare.com
 * /email-service/configuration/email-routing-addresses/, "Routing rule
 * actions", last updated 2026-10-15). So the first `up` creates the address
 * and both rules, and the forwards deliver once someone opens that mail and
 * clicks; no second deploy is needed. The stack output `inboundMailOperator`
 * says which state Pulumi last read.
 *
 * ## Account-level, and kept
 *
 * Destination addresses belong to the ACCOUNT, are shared by every zone in it,
 * and "deleting a destination address automatically disables all routing rules
 * that use that address" (same page). So the address is `retainOnDelete`:
 * unsetting the domain, or a destroy, deletes this stack's two rules and leaves
 * the address, which another zone's rule may use. One that already exists in
 * the account (added in the dashboard, or by another stack) is not created
 * twice: import it once, `pulumi import
 * cloudflare:index/emailRoutingAddress:EmailRoutingAddress inbound-mail-operator
 * '<account_id>/<destination_address_id>'` (the runbook's §7).
 *
 * Declared whenever the domain is set, switched off included: the domain still
 * has MX at Cloudflare, and its postmaster must still answer.
 */

export interface OperatorForwards {
  address: cloudflare.EmailRoutingAddress;
  /** `postmaster@`, then `abuse@`. */
  rules: cloudflare.EmailRoutingRule[];
}

/**
 * The address's options beyond the provider. Exported for the spec: Pulumi's
 * mocks do not carry resource options.
 */
export const OPERATOR_ADDRESS_OPTIONS = {
  // Deleting it disables every rule in the account that forwards to it.
  retainOnDelete: true,
} as const satisfies pulumi.CustomResourceOptions;

export function installOperatorForwards(cfg: DeployConfig, zone: MailZone): OperatorForwards {
  const { domain, operatorAddress } = cfg.inboundMail;
  const address = new cloudflare.EmailRoutingAddress(
    "inbound-mail-operator",
    // From the guarded zone lookup, like every other resource here.
    { accountId: zone.accountId, email: operatorAddress },
    { provider: zone.provider, ...OPERATOR_ADDRESS_OPTIONS },
  );
  const rules = RFC2142_LOCAL_PARTS.map(
    (local) =>
      new cloudflare.EmailRoutingRule(
        `inbound-mail-${local}`,
        {
          zoneId: zone.zoneId,
          name: `${local}@ (RFC 2142), forwarded to the operator`,
          enabled: true,
          matchers: [{ type: "literal", field: "to", value: `${local}@${domain}` }],
          actions: [{ type: "forward", values: [address.email] }],
        },
        { provider: zone.provider, dependsOn: [zone.routing, address] },
      ),
  );
  return { address, rules };
}

/** The stack output: the address, and whether Pulumi last read it as verified. */
export function operatorAddressStatus(forwards: OperatorForwards): pulumi.Output<string> {
  return pulumi
    .all([forwards.address.email, forwards.address.verified])
    .apply(([email, verified]) =>
      verified
        ? `${email} (verified ${verified})`
        : `${email} (NOT verified as of Pulumi's last read: the postmaster@ and abuse@ rules exist, but Cloudflare ` +
          "keeps them disabled until someone opens its verification mail to this address and clicks. `pulumi refresh` re-reads it)",
    );
}
