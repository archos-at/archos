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
 * to it. Its docs say "all routing rules are automatically disabled until the
 * destination address is validated by the user" (developers.cloudflare.com
 * /email-service/configuration/email-routing-addresses/, "Routing rule
 * actions"), but the API refuses to create a forward to an unverified address:
 * `400`, code `2054`, "Destination address is not verified" (dev, 2026-11-05).
 * So the first `up` creates the address and fails at both rules; after the
 * click, a second `up` creates them (runbook §7). The stack output
 * `inboundMailOperator` says which state Pulumi last read.
 *
 * ## Or an address the account already holds, verified
 *
 * `inboundMailOperatorAddressShared: true` points the forwards at a destination
 * address that already exists in the account (another stack's, which owns it,
 * or one added by hand) and declares no address resource: nothing new is
 * mailed a verification link, so the first `up` needs no click. The preview
 * reads the account's destination addresses and refuses unless this one is
 * there and verified; the forwards take their zone id from that read, so none
 * is registered unless it passed. That is a failed preview with nothing
 * changed, instead of an apply that stops at the forwards (prod, 2026-11-14:
 * it shares dev's address, verified since 2026-11-05).
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
  /** The destination address, while this stack owns it; absent when shared. */
  address?: cloudflare.EmailRoutingAddress;
  /** The mailbox the forwards point at. */
  email: pulumi.Output<string>;
  /** When Cloudflare verified it, as Pulumi last read it; empty while unverified. */
  verified: pulumi.Output<string>;
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

/** The parts of a destination address the shared-address guard reads. */
export interface DestinationAddress {
  email: string;
  /** When it was verified; empty or null while the click is outstanding. */
  verified?: string | null;
}

/**
 * Refuse a shared operator address the account does not hold, or holds
 * unverified: a forward to it is refused by the API (error 2054) half-way
 * through the apply. Returns the verification date.
 */
export function assertSharedAddressVerified(email: string, accountId: string, addresses: readonly DestinationAddress[]): string {
  const found = addresses.find((a) => a.email.trim().toLowerCase() === email);
  if (found?.verified) return found.verified;
  throw new Error(
    `inboundMailOperatorAddressShared is true, but ${email} is ` +
      (found ? "a destination address of the account NOT verified yet" : `no destination address of account ${accountId}`) +
      ": the postmaster@ and abuse@ forwards would fail with Cloudflare error 2054. Open Cloudflare's verification mail " +
      "to it and click, or set inboundMailOperatorAddressShared false so this stack creates the address (then the first " +
      "apply stops at the forwards until the click; runbook §7).",
  );
}

export function installOperatorForwards(cfg: DeployConfig, zone: MailZone): OperatorForwards {
  const { domain, operatorAddress, operatorAddressShared } = cfg.inboundMail;
  const owned = operatorAddressShared ? undefined : ownedAddress(operatorAddress, zone);
  const guard = owned ? undefined : sharedAddressGuard(operatorAddress, zone);
  const zoneId = guard ? pulumi.all([zone.zoneId, guard]).apply(([id]) => id) : zone.zoneId;
  const email = owned ? owned.email : pulumi.output(operatorAddress);
  const rules = RFC2142_LOCAL_PARTS.map(
    (local) =>
      new cloudflare.EmailRoutingRule(
        `inbound-mail-${local}`,
        {
          zoneId,
          name: `${local}@ (RFC 2142), forwarded to the operator`,
          enabled: true,
          matchers: [{ type: "literal", field: "to", value: `${local}@${domain}` }],
          actions: [{ type: "forward", values: [email] }],
        },
        { provider: zone.provider, dependsOn: [zone.routing, ...(owned ? [owned] : [])] },
      ),
  );
  return {
    address: owned,
    email,
    verified: owned ? owned.verified.apply((v) => v ?? "") : (guard as pulumi.Output<string>),
    rules,
  };
}

function ownedAddress(email: string, zone: MailZone): cloudflare.EmailRoutingAddress {
  return new cloudflare.EmailRoutingAddress(
    "inbound-mail-operator",
    // From the guarded zone lookup, like every other resource here.
    { accountId: zone.accountId, email },
    { provider: zone.provider, ...OPERATOR_ADDRESS_OPTIONS },
  );
}

/** The account's destination addresses, read at preview; resolves to the verification date or throws. */
function sharedAddressGuard(email: string, zone: MailZone): pulumi.Output<string> {
  const listed = cloudflare.getEmailRoutingAddressesOutput({ accountId: zone.accountId }, { provider: zone.provider });
  return pulumi
    .all([zone.accountId, listed])
    .apply(([accountId, addresses]) => assertSharedAddressVerified(email, accountId, addresses.results));
}

/** The stack output: the address, and whether Pulumi last read it as verified. */
export function operatorAddressStatus(forwards: OperatorForwards): pulumi.Output<string> {
  const shared = forwards.address === undefined;
  return pulumi
    .all([forwards.email, forwards.verified])
    .apply(([email, verified]) =>
      verified
        ? `${email} (verified ${verified}${shared ? "; shared: another owner's destination address, not created here" : ""})`
        : `${email} (NOT verified as of Pulumi's last read: the postmaster@ and abuse@ rules exist, but Cloudflare ` +
          "keeps them disabled until someone opens its verification mail to this address and clicks. `pulumi refresh` re-reads it)",
    );
}
