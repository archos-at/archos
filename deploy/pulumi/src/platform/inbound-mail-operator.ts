import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { RFC2142_LOCAL_PARTS } from "../config/inbound-mail";
import type { MailZone } from "./email-routing";

export interface OperatorForwards {
  address?: cloudflare.EmailRoutingAddress;
  email: pulumi.Output<string>;
  verified: pulumi.Output<string>;
  rules: cloudflare.EmailRoutingRule[];
}

export const OPERATOR_ADDRESS_OPTIONS = {
  retainOnDelete: true,
} as const satisfies pulumi.CustomResourceOptions;

export interface DestinationAddress {
  email: string;
  verified?: string | null;
}

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
    { accountId: zone.accountId, email },
    { provider: zone.provider, ...OPERATOR_ADDRESS_OPTIONS },
  );
}

function sharedAddressGuard(email: string, zone: MailZone): pulumi.Output<string> {
  const listed = cloudflare.getEmailRoutingAddressesOutput({ accountId: zone.accountId }, { provider: zone.provider });
  return pulumi
    .all([zone.accountId, listed])
    .apply(([accountId, addresses]) => assertSharedAddressVerified(email, accountId, addresses.results));
}

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
