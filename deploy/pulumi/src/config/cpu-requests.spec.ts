import { describe, it, expect, afterEach } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { cpuRequest, cpuUtilizationTarget, scaledCpuRequest } from "./cpu-requests";

pulumi.runtime.setMocks({ newResource: (args) => ({ id: args.name, state: args.inputs }), call: () => ({}) }, "grid-oib", "test", false);

const withScale = (scale?: string) => pulumi.runtime.setAllConfig(scale === undefined ? {} : { "grid-oib:cpuRequestScale": scale });

describe("cpuRequest", () => {
  afterEach(() => withScale());

  it("returns the quantity as written when the knob is unset", () => {
    withScale();
    expect(cpuRequest("1")).toBe("1");
    expect(cpuRequest("250m")).toBe("250m");
    expect(cpuUtilizationTarget(70)).toBe(70);
  });

  it("scales to whole millicores, rounding up, with a 10m floor that never raises a request", () => {
    withScale("0.25");
    expect(cpuRequest("1")).toBe("250m");
    expect(cpuRequest("250m")).toBe("63m");
    expect(cpuRequest("25m")).toBe("10m");
    expect(cpuRequest("10m")).toBe("10m");
    expect(cpuRequest("5m")).toBe("5m");
  });

  it("leaves limits and memory alone and keeps the autoscalers' absolute trigger", () => {
    withScale("0.25");
    const block = { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "4Gi" } };
    expect(scaledCpuRequest(block)).toEqual({ requests: { cpu: "125m", memory: "1Gi" }, limits: { cpu: "2", memory: "4Gi" } });
    expect(cpuUtilizationTarget(70)).toBe(280);
  });

  it.each(["0", "-1", "1.5", "a quarter"])("refuses %s", (scale) => {
    withScale(scale);
    expect(() => cpuRequest("1")).toThrow(/cpuRequestScale must be a number above 0 and at most 1/);
  });
});
