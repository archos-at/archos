import { describe, it, expect, beforeEach } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";

pulumi.runtime.setMocks(
  { newResource: (args) => ({ id: `${args.name}-id`, state: args.inputs }), call: () => ({}) },
  "grid-oib",
  "test",
  false,
);

async function envFor(extra: Record<string, string>) {
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...extra });
  const { loadConfig } = await import("../config");
  const { webMailEnv } = await import("./web-mail");
  return webMailEnv(loadConfig()).map((v) => v.name);
}

describe("the website's form mail", () => {
  beforeEach(() => pulumi.runtime.setAllConfig(baseStackConfig()));

  it("sets nothing when unconfigured, so the forms keep the mail-program hand-off", async () => {
    expect(await envFor({})).toEqual([]);
  });

  it("passes the SMTP login and the Attio key", async () => {
    const names = await envFor({
      "grid-oib:websiteSmtpUser": "sender@example.test",
      "grid-oib:websiteSmtpPassword": "app-password", // pragma: allowlist secret
      "grid-oib:attioApiKey": "attio", // pragma: allowlist secret
    });
    expect(names).toEqual(["SMTP_USER", "SMTP_PASSWORD", "ATTIO_API_KEY"]);
  });

  it("refuses a user without its password", async () => {
    await expect(envFor({ "grid-oib:websiteSmtpUser": "sender@example.test" })).rejects.toThrow(/go together/);
  });
});
