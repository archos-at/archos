import { describe, it, expect, beforeAll } from "vitest";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig, forProject } from "../test-support/stack-config";

/** Any project name: the program reads its keys through the running project (ADR-0147). */
const PROJECT = "stack";

/**
 * The public-source fetcher (ADR-0162). What plans clean and is still wrong:
 *   - a fetcher that can reach the cluster (a missing egress rule, a private
 *     range left out): any source whose DNS answers 10.x reads Qdrant;
 *   - a fetcher any pod may call: a turn-less process gets a free proxy;
 *   - a backend without the URL: it reads no source at all, since there is no
 *     in-pod path any more;
 *   - a rollout that kills a pod mid-parse: the caller waits 50 s for an
 *     extract, so the old pod must outlive the longest one.
 */

const RESOURCES: Array<{ type: string; name: string; inputs: Record<string, any> }> = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      RESOURCES.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: { ...args.inputs, metadata: args.inputs.metadata ?? { name: args.name } } };
    },
    call: () => ({}),
  },
  PROJECT,
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

describe("public-source-fetcher", () => {
  let mod: typeof import("./public-source-fetcher");
  let cfg: Awaited<ReturnType<typeof import("../config")["loadConfig"]>>;

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({ ...forProject(baseStackConfig(), PROJECT), [`${PROJECT}:observabilityEnabled`]: "false" });
    const { loadConfig } = await import("../config");
    mod = await import("./public-source-fetcher");
    cfg = loadConfig();
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const fetcher = mod.installPublicSourceFetcher(cfg, provider, "app", []);
    await new Promise((done) => fetcher.service.id.apply(done));
  });

  it("is part of every stack: no switch, and the backend always gets its URL", () => {
    expect(cfg.publicSourceFetcher).toEqual({ replicas: 1 });
    expect(mod.publicSourceFetcherEnv()).toEqual([
      { name: "PUBLIC_SOURCE_FETCHER_URL", value: "http://public-source-fetcher:8095" },
    ]);
  });

  it("has room for two PDF readers of 1 GiB each beside the server, and requests one", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "public-source-fetcher").inputs.spec);
    expect(spec.template.spec.containers[0].resources.limits.memory).toBe("2560Mi");
    expect(spec.template.spec.containers[0].resources.requests.memory).toBe("1Gi");
  });

  it("lets a voluntary disruption take at most one fetcher pod", async () => {
    const pdb = await resolve(find("kubernetes:policy/v1:PodDisruptionBudget", "public-source-fetcher").inputs.spec);
    expect(pdb.maxUnavailable).toBe(1);
    expect(pdb.selector.matchLabels["app.kubernetes.io/name"]).toBe("public-source-fetcher");
  });

  it("drains a parse in flight before it stops, and rolls out without dropping capacity", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "public-source-fetcher").inputs.spec);
    const pod = spec.template.spec;
    const drain = 5;
    const extractWaitSeconds = 50; // EXTRACT_TIMEOUT_SECONDS in public_sources/pdf.py
    expect(pod.containers[0].lifecycle.preStop.exec.command).toEqual(["python", "-c", `import time; time.sleep(${drain})`]);
    expect(pod.terminationGracePeriodSeconds).toBeGreaterThan(drain + extractWaitSeconds);
    expect(spec.strategy.rollingUpdate).toEqual({ maxUnavailable: 0, maxSurge: 1 });
    expect(spec.minReadySeconds).toBeGreaterThan(0);
  });

  it("runs the fetcher module on the backend image with no token and no secret", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "public-source-fetcher").inputs.spec);
    const pod = spec.template.spec;
    const c = pod.containers[0];
    expect(c.command).toEqual(["/app/.venv/bin/python", "-m", "public_sources.fetcher"]);
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(c.envFrom).toBeUndefined();
    expect(c.env.map((e: { name: string }) => e.name).sort()).toEqual(["PORT", "PUBLIC_SOURCES_DIR"]);
    expect(c.readinessProbe.httpGet).toEqual({ path: "/healthz", port: 8095 });
  });

  it("admits only the tool-running roles and reaches only DNS and public addresses on 443", async () => {
    const policy = find("kubernetes:networking.k8s.io/v1:NetworkPolicy", "public-source-fetcher-sandbox");
    const spec = await resolve(policy.inputs.spec);
    expect(spec.policyTypes).toEqual(["Ingress", "Egress"]);
    const callers = spec.ingress[0].from.map((f: any) => f.podSelector.matchLabels["app.kubernetes.io/name"]);
    expect(callers).toEqual(expect.arrayContaining(["agent-worker"]));
    expect(callers).not.toContain("frontend");
    expect(callers).not.toContain("ingest-worker");

    const [dns, web] = spec.egress;
    expect(dns.ports.map((p: any) => p.port)).toEqual([53, 53]);
    expect(web.ports).toEqual([{ protocol: "TCP", port: 443 }]);
    const v4 = web.to.find((t: any) => t.ipBlock.cidr === "0.0.0.0/0").ipBlock.except;
    for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"]) {
      expect(v4).toContain(range);
    }
    const v6 = web.to.find((t: any) => t.ipBlock.cidr === "::/0").ipBlock.except;
    expect(v6).toEqual(expect.arrayContaining(["fc00::/7", "fe80::/10"]));
  });
});
