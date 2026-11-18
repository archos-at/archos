import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { load } from "js-yaml";
import { baseStackConfig } from "../test-support/stack-config";
import { LEGACY_PROJECT, objectName } from "../names";

const NAMESPACE = objectName("namespace", LEGACY_PROJECT);

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
  LEGACY_PROJECT,
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
const REPO = join(__dirname, "..", "..", "..", "..");

function directives(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split(/\s+/);
    expect(map.has(key), `${key} set twice`).toBe(false);
    map.set(key, rest.join(" "));
  }
  return map;
}

type ComposeService = {
  image: string;
  profiles?: string[];
  ports?: unknown;
  volumes: string[];
  environment: string[];
  healthcheck: { test: string[] };
};
function composeService(name: string): ComposeService {
  const doc = load(readFileSync(join(REPO, "deploy", "compose", "docker-compose.yaml"), "utf8")) as {
    services: Record<string, ComposeService>;
  };
  return doc.services[name];
}

type ComposeMount = { host: string; readOnly: boolean };
function composeMountAt(service: ComposeService, target: string): ComposeMount {
  for (const volume of service.volumes) {
    const [host, mounted, mode] = volume.split(":");
    if (mounted === target) return { host, readOnly: mode === "ro" };
  }
  throw new Error(`Compose mounts nothing at ${target}`);
}

type Mount = { name: string; mountPath: string; subPath?: string; readOnly?: boolean };
async function clamdMounts(): Promise<Mount[]> {
  const spec = await resolve(find("kubernetes:apps/v1:Deployment", "clamav").inputs.spec);
  return spec.template.spec.containers[0].volumeMounts;
}
function mountPathOf(mounts: Mount[], name: string, subPath?: string): string {
  const mount = mounts.find((m) => m.name === name && m.subPath === subPath);
  if (!mount) throw new Error(`no ${name} mount${subPath ? ` of ${subPath}` : ""}`);
  return mount.mountPath;
}

describe("clamav", () => {
  let cfgImage = "";
  let env: k8s.types.input.core.v1.EnvVar[] = [];
  let envDisabled: k8s.types.input.core.v1.EnvVar[] = [];
  let jobsEnv: k8s.types.input.core.v1.EnvVar[] = [];

  beforeAll(async () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      [`${LEGACY_PROJECT}:observabilityEnabled`]: "false",
      [`${LEGACY_PROJECT}:malwareScanEnabled`]: "true",
    });
    const { loadConfig } = await import("../config");
    const { installClamAV } = await import("./clamav");
    const { installNetworkPolicies } = await import("../platform/network-policies");
    const { frontendEnv } = await import("./config");
    const { bffJobsEnv } = await import("./bff-jobs-env");
    const cfg = loadConfig();
    cfgImage = cfg.malwareScan.image;
    const provider = new k8s.Provider("test", { kubeconfig: "apiVersion: v1" });
    const clamav = installClamAV(cfg, provider, NAMESPACE, []);
    installNetworkPolicies(cfg, provider, NAMESPACE);
    const wiring = {
      cfg,
      namespace: NAMESPACE,
      provider,
      redisUrl: pulumi.output("redis://dragonfly:6379"),
      seaweedInternalEndpoint: pulumi.output("http://seaweedfs:8333"),
      seaweedPublicEndpoint: pulumi.output("https://s3.example.test"),
      qdrantUrl: pulumi.output(`http://qdrant.${NAMESPACE}.svc.cluster.local:6333`),
      dsn: () => pulumi.output("postgresql://x"),
      imagePullSecrets: [],
    };
    env = frontendEnv({ ...wiring, malwareScanUrl: clamav.url });
    jobsEnv = bffJobsEnv({ ...wiring, malwareScanUrl: clamav.url });
    envDisabled = frontendEnv(wiring);
    await new Promise((done) => clamav.service.id.apply(done));
  });

  it("closes, in clamd.conf, every way clamd answers OK for bytes it did not inspect (RT-S4)", async () => {
    const { clamavConfigFiles } = await import("./clamav");
    const conf = directives(clamavConfigFiles()["clamd.conf"]);
    for (const alert of [
      "HeuristicAlerts",
      "AlertExceedsMax",
      "AlertEncrypted",
      "AlertEncryptedArchive",
      "AlertEncryptedDoc",
      "AlertOLE2Macros",
      "AlertBrokenExecutables",
      "ScanMail",
      "ScanArchive",
    ]) {
      expect(conf.get(alert), alert).toBe("yes");
    }
    expect(conf.get("HeuristicScanPrecedence")).toBe("no");
    expect(conf.get("ExtendedDetectionInfo")).toBe("no");
    expect(conf.get("StreamMaxLength")).toBe("30M");
    expect(Number(conf.get("MaxScanTime"))).toBeGreaterThan(0);
  });

  it("serves clamd on the Service's port, with its signatures in the database volume the pod mounts", async () => {
    const { clamavConfigFiles } = await import("./clamav");
    const conf = directives(clamavConfigFiles()["clamd.conf"]);
    const svc = await resolve(find("kubernetes:core/v1:Service", "clamav").inputs.spec);
    expect(conf.get("TCPSocket")).toBe(String(svc.ports[0].targetPort));
    expect(conf.get("DatabaseDirectory")).toBe(mountPathOf(await clamdMounts(), "database"));
  });

  it("runs clamd and freshclam as the image's clamav user, past the root entrypoint", async () => {
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "clamav").inputs.spec);
    const pod = spec.template.spec;
    const [clamd, freshclam] = pod.containers;
    expect(pod.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 100, runAsGroup: 101, fsGroup: 101 });
    expect(pod.automountServiceAccountToken).toBe(false);
    for (const c of [...pod.initContainers, clamd, freshclam]) {
      expect(c.image, c.name).toBe(cfgImage);
      expect(c.command, c.name).toBeDefined();
      expect(c.securityContext, c.name).toMatchObject({ runAsUser: 100, allowPrivilegeEscalation: false });
    }
    expect(clamd.command).toEqual(["clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"]);
    expect(freshclam.command).toEqual(expect.arrayContaining(["freshclam", "--daemon", "--config-file=/etc/clamav/freshclam.conf"]));
    expect(pod.initContainers[0].command.join(" ")).toContain("cp /var/lib/clamav/* /seed/");
    expect(pod.volumes.find((v: { name: string }) => v.name === "database").emptyDir).toBeDefined();
    expect(clamd.resources.requests.memory).toBe("2Gi");
  });

  it("is ready only while clamd answers and its signatures are under 48 hours old", async () => {
    const { readinessScript, livenessScript } = await import("./clamav");
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "clamav").inputs.spec);
    const clamd = spec.template.spec.containers[0];
    expect(clamd.readinessProbe.exec.command).toEqual(["sh", "-c", readinessScript()]);
    expect(readinessScript()).toContain("zVERSION");
    expect(readinessScript()).toContain(`-lt ${48 * 3600}`);
    expect(clamd.livenessProbe.exec.command).toEqual(["sh", "-c", livenessScript()]);
    expect(livenessScript()).toContain("zPING");
    expect(livenessScript()).not.toContain("VERSION");
    expect(clamd.startupProbe.exec.command).toEqual(["sh", "-c", livenessScript()]);
  });

  it("lets pulumi up go on without waiting for fresh signatures", async () => {
    const metadata = await resolve(find("kubernetes:apps/v1:Deployment", "clamav").inputs.metadata);
    expect(metadata.annotations).toEqual({ "pulumi.com/skipAwait": "true" });
  });

  it("rolls the pod when either config file changes", async () => {
    const { clamavConfigFiles } = await import("./clamav");
    const cm = find("kubernetes:core/v1:ConfigMap", "clamav-config");
    expect(await resolve(cm.inputs.data)).toEqual(clamavConfigFiles());
    const spec = await resolve(find("kubernetes:apps/v1:Deployment", "clamav").inputs.spec);
    expect(Object.keys(spec.template.metadata.annotations)).toHaveLength(1);
  });

  it("hands the frontend and the bff-jobs pool the Service's address, and nothing when off", async () => {
    const svc = await resolve(find("kubernetes:core/v1:Service", "clamav").inputs.spec);
    expect(svc.ports[0].port).toBe(3310);
    for (const list of [env, jobsEnv]) {
      const url = list.find((e) => e.name === "MALWARE_SCAN_URL");
      expect(await resolve(url?.value)).toBe("tcp://clamav:3310");
    }
    expect(envDisabled.some((e) => e.name === "MALWARE_SCAN_URL")).toBe(false);
    expect(composeService("frontend").environment.map((e) => e.split("=")[0])).toContain("MALWARE_SCAN_URL");
  });

  it("admits the frontend and the bff-jobs pool alone", async () => {
    const pol = await resolve(find(NETPOL, "clamav-bff-only").inputs.spec);
    expect(pol.policyTypes).toEqual(["Ingress"]);
    expect(pol.ingress).toEqual([
      {
        from: [
          { podSelector: { matchLabels: { "app.kubernetes.io/name": "frontend" } } },
          { podSelector: { matchLabels: { "app.kubernetes.io/name": "bff-jobs" } } },
        ],
        ports: [{ protocol: "TCP", port: 3310 }],
      },
    ]);
    const intra = await resolve(find(NETPOL, "allow-same-namespace").inputs.spec);
    expect(intra.podSelector.matchExpressions[0].values).toContain("clamav");
  });

  it("matches the Compose service: image, profile, the same mounts with the same config bytes, no port, and the same health check", async () => {
    const { readinessScript, clamavConfigFiles } = await import("./clamav");
    const files: Record<string, string> = clamavConfigFiles();
    const svc = composeService("clamav");
    expect(svc.image).toBe(cfgImage);
    expect(svc.profiles).toEqual(["malware-scan"]);
    expect(svc.ports).toBeUndefined();
    for (const mount of await clamdMounts()) {
      const compose = composeMountAt(svc, mount.mountPath);
      expect(compose.readOnly, mount.mountPath).toBe(mount.readOnly === true);
      if (mount.subPath) {
        expect(readFileSync(join(REPO, "deploy", "compose", compose.host), "utf8"), mount.mountPath).toBe(files[mount.subPath]);
      }
    }
    expect(svc.healthcheck.test[0]).toBe("CMD-SHELL");
    expect(svc.healthcheck.test[1].split("$$").join("$")).toBe(readinessScript());
  });

  it("checks for signatures as often as Compose does, and tells the clamd that reads the same config", async () => {
    const { clamavConfigFiles } = await import("./clamav");
    const fresh = directives(clamavConfigFiles()["freshclam.conf"]);
    expect(composeService("clamav").environment).toContain(`FRESHCLAM_CHECKS=${fresh.get("Checks")}`);
    const mounts = await clamdMounts();
    expect(fresh.get("NotifyClamd")).toBe(mountPathOf(mounts, "config", "clamd.conf"));
    expect(fresh.get("DatabaseDirectory")).toBe(mountPathOf(mounts, "database"));
  });
});
