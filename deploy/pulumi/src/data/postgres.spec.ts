import { describe, it, expect } from "vitest";
import { sslParamFor } from "./postgres";

describe("sslParamFor", () => {
  it("gives asyncpg the parameter it actually accepts", () => {
    expect(sslParamFor("postgresql+asyncpg")).toBe("ssl");
  });

  it.each([
    ["the default libpq-shaped scheme", "postgresql"],
    ["psycopg", "postgresql+psycopg"],
    ["node-postgres / postgres-js", "postgres"],
  ])("gives %s `sslmode`", (_label, driver) => {
    expect(sslParamFor(driver)).toBe("sslmode");
  });

  it("keys on the driver, not on an exact scheme string", () => {
    expect(sslParamFor("postgresql+asyncpg_something")).toBe("ssl");
  });
});
