import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { load } from "js-yaml";
import { baseStackConfig } from "../test-support/stack-config";

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}-id`,
        state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } },
      };
    },
    call: () => ({}),
  },
  "grid-oib",
  "test",
  false,
);

function find(type: string, name: string) {
  const hit = RESOURCES.find((r) => r.type === type && r.name === name);
  if (!hit) throw new Error(`no ${type} named "${name}"`);
  return hit;
}

function resolve<T>(value: pulumi.Input<T>): Promise<T> {
  return new Promise((done) => pulumi.output(value).apply((v) => done(v as T)));
}

const NETPOL = "kubernetes:networking.k8s.io/v1:NetworkPolicy";

type ComposeService = { image: string; command: string[]; ports?: unknown };
function composeService(file: string): ComposeService {
  const path = join(__dirname, "..", "..", "..", "compose", file);
  const doc = load(readFileSync(path, "utf8")) as { services: Record<string, ComposeService> };
  return doc.services.gotenberg;
}

describe("gotenberg", () => {
  let env: k8s.types.input.core.v1.EnvVar[] = [];
  let envDisabled: k8s.types.input.core.v1.EnvVar[] = [];
  let cfgImage = "";
  let defaults: Awaited<ReturnType<typeof import("../config")["loadConfig"]>> = undefined as never;

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:observabilityEnabled": "false" });
    const { loadConfig } = await import("../config");
    const { installGotenberg } = await import("./gotenberg");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const { frontendEnv } = await import("./config");
    const cfg = loadConfig();
    cfgImage = cfg.gotenberg.image;
    defaults = cfg;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const g = installGotenberg(cfg, provider, "grid", []);
    installNetworkPolicies(cfg, provider, "grid");
    const wiring = {
      cfg,
      namespace: "grid",
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output("http://qdrant.grid.svc.cluster.local:6333"),
      dsn: () => pulumi.output("postgresql://x"),
      imagePullSecrets: [],
    };
    env = frontendEnv({ ...wiring, gotenbergUrl: g.url });
    envDisabled = frontendEnv(wiring);
    await new Promise((done) => g.service.id.apply(done));
  });

  it("defaults on, pinned to a concrete 8.x LibreOffice-only tag", () => {
    expect(cfgImage).toMatch(/^gotenberg\/gotenberg:8\.\d+\.\d+-libreoffice$/);
  });

  it("runs only the LibreOffice route, with every URL-fetching feature off", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "gotenberg").inputs.spec);
    const pod = spec.template.spec;
    const c = pod.containers[0];

    expect(c.image).toBe(cfgImage);
    expect(c.args).toEqual(
      expect.arrayContaining([
        "--api-timeout=120s",
        "--api-disable-download-from",
        "--webhook-disable",
        "--libreoffice-deny-private-ips",
        "--libreoffice-deny-public-ips",
      ]),
    );
    expect(c.args.some((a: string) => a.startsWith("--chromium"))).toBe(false);
    expect(c).not.toHaveProperty("command");
    expect(c.readinessProbe.httpGet).toEqual({ path: "/health", port: 3000 });
    expect(c.livenessProbe.httpGet).toEqual({ path: "/health", port: 3000 });
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1001 });
  });

  it("drains a conversion in flight instead of cutting it at a rollout", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "gotenberg").inputs.spec);
    const pod = spec.template.spec;
    const c = pod.containers[0];
    expect(c.lifecycle.preStop.exec.command).toEqual(["sleep", "5"]);
    expect(c.args).toContain("--gotenberg-graceful-shutdown-duration=120s");
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThan(5 + 120);
    expect(spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
  });

  it("hands the frontend the Service's address", async () => {
    const svc = await resolve(find("kubernetes:core/v1:Service", "gotenberg").inputs.spec);
    expect(svc.ports[0].port).toBe(3000);

    const url = env.find((e) => e.name === "GOTENBERG_URL");
    expect(await resolve(url?.value)).toBe("http://gotenberg:3000");
    expect(envDisabled.some((e) => e.name === "GOTENBERG_URL")).toBe(false);
  });

  it("admits the frontend and the bff-jobs pool alone, and denies every egress", async () => {
    const pol = await resolve(find(NETPOL, "gotenberg-frontend-only").inputs.spec);
    expect(pol.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(pol.egress).toEqual([]);
    expect(pol.ingress).toEqual([
      {
        from: [
          { podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } },
          { podSelector: { matchLabels: { "app.kubernetes.io/name": "bff-jobs" } } },
        ],
        ports: [{ protocol: "TCP", port: 3000 }],
      },
    ]);

    const intra = await resolve(find(NETPOL, "allow-same-namespace").inputs.spec);
    expect(intra.podSelector.matchExpressions[0].values).toContain("gotenberg");
  });

  it("runs the configured number of converter replicas", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "gotenberg").inputs.spec);

    expect(spec.replicas).toBe(defaults.gotenberg.replicas);
    expect(defaults.gotenberg.replicas).toBeGreaterThanOrEqual(1);
  });

  describe("the pool's conversions fit the converter", () => {
    const stackKnob = (stack: "dev" | "prod", key: string, fallback: number): number => {
      const text = readFileSync(join(__dirname, "..", "..", `Pulumi.${stack}.yaml`), "utf8");
      const hit = text.match(new RegExp(`^\\s*grid-oib:${key}: "?(\\d+)"?\\s*$`, "m"));
      return hit ? Number(hit[1]) : fallback;
    };

    it.each(["dev", "prod"] as const)("in the %s stack", async (stack) => {
      const { renditionCeiling, gotenbergCapacity } = await import("../config");
      const cfg = {
        bffJobs: {
          maxReplicas: Math.max(1, stackKnob(stack, "bffJobsMaxReplicas", defaults.bffJobs.maxReplicas)),
          renditionConcurrency: Math.max(
            1,
            stackKnob(stack, "bffJobsRenditionConcurrency", defaults.bffJobs.renditionConcurrency),
          ),
        },
        gotenberg: { replicas: Math.max(1, stackKnob(stack, "gotenbergReplicas", defaults.gotenberg.replicas)) },
      };

      expect(renditionCeiling(cfg as never)).toBeLessThanOrEqual(gotenbergCapacity(cfg as never));
    });

    it("holds the defaults too, for a stack that sets none of the knobs", async () => {
      const { renditionCeiling, gotenbergCapacity } = await import("../config");

      expect(renditionCeiling(defaults)).toBeLessThanOrEqual(gotenbergCapacity(defaults));
    });

    it("counts a pod that converts two files at once, and fails a pool that outgrows the converter", async () => {
      const { renditionCeiling, gotenbergCapacity, GOTENBERG_SLOTS_PER_REPLICA } = await import("../config");

      expect(renditionCeiling({ bffJobs: { maxReplicas: 4, renditionConcurrency: 2 } } as never)).toBe(8);
      expect(gotenbergCapacity({ gotenberg: { replicas: 2 } } as never)).toBe(2 * GOTENBERG_SLOTS_PER_REPLICA);
      expect(renditionCeiling({ bffJobs: { maxReplicas: 4, renditionConcurrency: 2 } } as never)).toBeGreaterThan(
        gotenbergCapacity({ gotenberg: { replicas: 1 } } as never),
      );
    });
  });

  it("matches the Compose services, image and flags", async () => {
    const { GOTENBERG } = await import("../constants");
    for (const file of ["docker-compose.yaml"]) {
      const svc = composeService(file);
      expect(svc.image, file).toBe(cfgImage);
      expect(svc.command, file).toEqual([...GOTENBERG.args]);
      expect(svc.ports, file).toBeUndefined();
    }
  });
});
