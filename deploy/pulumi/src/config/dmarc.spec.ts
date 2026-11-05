import { describe, it, expect } from "vitest";
import { dmarcRecordProblem } from "./dmarc";

/**
 * The DMARC record check `loadConfig` and `stack-files.spec.ts` run before a
 * record is published: a receiver that cannot parse one acts as if the domain
 * had none, so a typo switches the policy off without a sound.
 */
describe("a DMARC record", () => {
  it.each([
    "v=DMARC1; p=none; sp=none; adkim=r; aspf=r; rua=mailto:mail-ops@company.example",
    // The prod stack's dnsDmarc today, trailing separator included.
    "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;",
    "v=DMARC1;p=reject;pct=100;fo=1:d;ri=86400;rua=mailto:a@example.org!10m,mailto:b@example.org",
  ])("accepts %s", (record) => {
    expect(dmarcRecordProblem(record)).toBeUndefined();
  });

  it.each([
    ["", /empty/],
    ["p=none; v=DMARC1", /must start with "v=DMARC1;"/],
    ["v=DMARC2; p=none", /must start with "v=DMARC1;"/],
    ["v=DMARC1; p=none; p=reject", /appears twice/],
    ["v=DMARC1; p=none; adkim=relaxed", /"adkim=relaxed" is not a valid value/],
    ["v=DMARC1; p=none; pct=101", /"pct=101"/],
    ["v=DMARC1; p=none; rua=ops@company.example", /"rua=ops@company.example"/],
    ["v=DMARC1; sp=none", /no "p=" policy/],
  ])("refuses %j", (record, message) => {
    expect(dmarcRecordProblem(record)).toMatch(message);
  });
});
