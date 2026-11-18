import { describe, it, expect } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { loadConfig } from './config'
import { RETIRED_VECTOR_KEYS } from './config/qdrant'
import { LEGACY_PROJECT } from './names'
import { baseStackConfig } from "./test-support/stack-config";
import {
  APP_ZONE,
  APP_ZONE_ID,
  appZoneStackConfig,
  MAIL_ZONE_ID,
  OPERATOR_ADDRESS,
  mailStackConfig,
  SIGNING_KEY_ID,
  SIGNING_SECRET,
} from "./test-support/app-zone-config";

pulumi.runtime.setMocks(
  { newResource: (args) => ({ id: `${args.name}-id`, state: args.inputs }), call: () => ({}) },
  "grid-oib",
  "test",
  false,
);

function loadWith(values: Record<string, string>, omit: string[] = []): Error | null {
  const config: Record<string, string> = {
    ...baseStackConfig(),
    ...values,
  };
  for (const key of omit) delete config[key];
  pulumi.runtime.setAllConfig(config);
  try {
    loadConfig();
    return null;
  } catch (error) {
    return error as Error;
  }
}

function loadValues(values: Record<string, string>) {
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...values });
  return loadConfig();
}

describe("tenant bucket prefix", () => {

  it.each([["true"], ["false"]])(
    "refuses a prefix that overlaps a platform bucket, with the feature %s",
    (perOrg) => {
      const error = loadWith({
        "grid-oib:seaweedfsPerOrgBuckets": perOrg,
        "grid-oib:seaweedfsTenantBucketPrefix": "grid-",
      });
      expect(error?.message).toMatch(/is a prefix of the platform bucket/);
    },
  );

  it("refuses a prefix with no trailing hyphen", () => {
    const error = loadWith({ "grid-oib:seaweedfsTenantBucketPrefix": "grid-org" });
    expect(error?.message).toMatch(/end with "-"/);
  });

  it("refuses the S3-reserved xn-- prefix", () => {
    const error = loadWith({ "grid-oib:seaweedfsTenantBucketPrefix": "xn--t-" });
    expect(error?.message).toMatch(/xn--/);
  });

  it("accepts the default", () => {
    expect(loadWith({})).toBeNull();
  });
});

describe("the retired Chroma tier and vector switch (ADR-0115)", () => {
  it.each([
    ["chromaEnabled", "true"],
    ["chromaImage", "chromadb/chroma:1.5.9"],
    ["chromaMigration", "true"],
    ["chromaStorageSize", "20Gi"],
    ["qdrantEnabled", "false"],
    ["vectorBackend", "chroma"],
  ])("refuses a stack that still sets %s", (key, value) => {
    const error = loadWith({ [`grid-oib:${key}`]: value });
    expect(error?.message).toMatch(new RegExp(`grid-oib:${key} is retired: Qdrant is the only vector store`));
    expect(error?.message).toMatch(/pulumi config rm/);
  });

  it("names every retired key at once", () => {
    const all = Object.fromEntries(RETIRED_VECTOR_KEYS.map((k) => [`grid-oib:${k}`, "x"]));
    expect(loadWith(all)?.message).toMatch(
      /grid-oib:chromaEnabled, grid-oib:chromaImage, grid-oib:chromaMigration, grid-oib:chromaMigrationScratchSize, grid-oib:chromaMigrationTimeoutMinutes, grid-oib:chromaStorageSize, grid-oib:qdrantEnabled, grid-oib:vectorBackend are retired/,
    );
  });
});

describe("the bff-jobs pool's floor", () => {
  it("refuses a floor of zero, naming what runs there", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [`${pulumi.getProject()}:bffJobsMinReplicas`]: "0" });
    expect(() => loadConfig()).toThrow(/bffJobsMinReplicas must be at least 1, not 0: .*scheduled automations and the maintenance sweeps/);
  });

  it("refuses the pool switched off", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [`${pulumi.getProject()}:bffJobsEnabled`]: "false" });
    expect(() => loadConfig()).toThrow(/bffJobsEnabled=false is refused/);
  });

  it("defaults to one replica", () => {
    pulumi.runtime.setAllConfig(baseStackConfig());
    expect(loadConfig().bffJobs.minReplicas).toBe(1);
  });
});

describe("the geocoder URL (ADR-0151, ADR-0159)", () => {
  const key = `${pulumi.getProject()}:geocoderUrl`;

  it("is off by default: no address keystroke leaves the cell unless a stack opts in", () => {
    pulumi.runtime.setAllConfig(baseStackConfig());
    expect(loadConfig().geocoderUrl).toBe("");
  });

  it("takes komoot's public Photon when a stack names it", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [key]: "https://photon.komoot.io" });
    expect(loadConfig().geocoderUrl).toBe("https://photon.komoot.io");
  });

  it("takes empty as address search off", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [key]: "" });
    expect(loadConfig().geocoderUrl).toBe("");
  });

  it("refuses a value that is no http(s) URL rather than serving it as off", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), [key]: "photon.komoot.io" });
    expect(() => loadConfig()).toThrow(/geocoderUrl must be an http\(s\) URL or empty/);
  });
});

describe("Qdrant (ADR-0115)", () => {
  it("defaults the cluster to the design's shape", () => {
    pulumi.runtime.setAllConfig(baseStackConfig());
    const cfg = loadConfig();
    expect(cfg.qdrant).toMatchObject({
      image: "qdrant/qdrant:v1.19.2",
      replicas: 3,
      cpu: "4",
      memory: "16Gi",
      storageSize: "100Gi",
      quotas: { memoryPercent: 90, diskPercent: 85 },
      snapshots: { schedule: "30 1 * * *", retentionDays: 7, s3AccessKey: "grid-qdrant" },
    });
  });

  it("refuses a low-memory mode Qdrant does not know, and accepts the two it does", () => {
    const error = loadWith({ "grid-oib:qdrantLowMemoryMode": "bogus" });
    expect(error?.message).toMatch(/qdrantLowMemoryMode must be one of no_resident, no_populate/);
    expect(loadWith({ "grid-oib:qdrantLowMemoryMode": "no_populate" })).toBeNull();
  });

  it("refuses a rotation key equal to the read-only key", () => {
    const error = loadWith({ "grid-oib:qdrantAltApiKey": "qd-ro" });
    expect(error?.message).toMatch(/qdrantAltApiKey must differ from grid-oib:qdrantReadOnlyApiKey/);
    expect(loadWith({ "grid-oib:qdrantAltApiKey": "qd-next" })).toBeNull();
  });

  it.each([
    ["qdrantQuotaMemoryPercent", "100"],
    ["qdrantQuotaDiskPercent", "0"],
    ["qdrantQuotaDiskPercent", "85.5"],
  ])("refuses %s=%s", (key, value) => {
    const error = loadWith({ [`grid-oib:${key}`]: value });
    expect(error?.message).toMatch(new RegExp(`${key} must be a whole percentage between 1 and 99`));
  });

  it("names every missing credential at once, on any stack", () => {
    const error = loadWith({}, ["grid-oib:qdrantApiKey", "grid-oib:qdrantReadOnlyApiKey", "grid-oib:qdrantS3SecretKey"]);
    expect(error?.message).toMatch(
      /grid-oib:qdrantApiKey, grid-oib:qdrantReadOnlyApiKey, grid-oib:qdrantS3SecretKey are required \(Qdrant is always deployed/,
    );
  });

  it("refuses a read-only key equal to the read-write key", () => {
    const error = loadWith({ "grid-oib:qdrantReadOnlyApiKey": "qd-rw" });
    expect(error?.message).toMatch(/qdrantReadOnlyApiKey must differ from grid-oib:qdrantApiKey/);
  });

  it("refuses a snapshot S3 secret shared with another identity", () => {
    const error = loadWith({ "grid-oib:qdrantS3SecretKey": "s3-secret" });
    expect(error?.message).toMatch(/qdrantS3SecretKey must differ from grid-oib:seaweedfsSecretKey/);
  });

  it("refuses two replicas and accepts one", () => {
    expect(loadWith({ "grid-oib:qdrantReplicas": "2" })?.message).toMatch(
      /qdrantReplicas=2 is refused/,
    );
    expect(loadWith({ "grid-oib:qdrantReplicas": "1" })).toBeNull();
  });

  it("refuses a snapshot schedule that is not 5-field cron", () => {
    const error = loadWith({ "grid-oib:qdrantSnapshotSchedule": "0 30 1 * * *" });
    expect(error?.message).toMatch(/qdrantSnapshotSchedule must be a 5-field cron/);
  });

  it("refuses a tenant prefix that would cover the snapshot bucket", () => {
    const error = loadWith({ "grid-oib:seaweedfsTenantBucketPrefix": "qdrant-" });
    expect(error?.message).toMatch(/is a prefix of the platform bucket "qdrant-snapshots"/);
  });
});

describe("Qdrant's dashboard at the edge", () => {
  const connectApp = {
    "grid-oib:otelOidcIssuer": "https://grid.authkit.app",
    "grid-oib:otelOidcClientId": "client_otel",
    "grid-oib:otelOidcClientSecret": "otel-client-secret", // pragma: allowlist secret
  };

  it("is on by default where the Connect application is set, on the qdrant.<baseDomain> host", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...connectApp });
    const cfg = loadConfig();
    expect(cfg.qdrant.dashboard).toEqual({ enabled: true, domain: "qdrant.example.test" });
    expect(cfg.dns.hosts).toContain("qdrant.example.test");
  });

  it("stands down by default on a stack without the Connect application", () => {
    pulumi.runtime.setAllConfig(baseStackConfig());
    const cfg = loadConfig();
    expect(cfg.qdrant.dashboard.enabled).toBe(false);
    expect(cfg.dns.hosts).not.toContain("qdrant.example.test");
  });

  it("stays off where a stack sets it false, Connect application or not", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...connectApp, "grid-oib:qdrantDashboardEnabled": "false" });
    const cfg = loadConfig();
    expect(cfg.qdrant.dashboard.enabled).toBe(false);
    expect(cfg.dns.hosts).not.toContain("qdrant.example.test");
  });

  it("joins the DNS host set when on, and takes an overridden host", () => {
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      ...connectApp,
      "grid-oib:qdrantDashboardEnabled": "true",
      "grid-oib:qdrantDashboardDomain": "vectors.example.test",
    });
    const cfg = loadConfig();
    expect(cfg.qdrant.dashboard).toEqual({ enabled: true, domain: "vectors.example.test" });
    expect(cfg.dns.hosts).toContain("vectors.example.test");
  });

  it("is covered by the zone check when DNS is managed", () => {
    const error = loadWith({
      ...connectApp,
      "grid-oib:qdrantDashboardEnabled": "true",
      "grid-oib:qdrantDashboardDomain": "qdrant.elsewhere.test",
      "grid-oib:loadBalancerIp": "203.0.113.10",
      "grid-oib:dnsEnabled": "true",
      "grid-oib:dnsZoneId": "00000000000000000000000000abc123",
      [`${LEGACY_PROJECT}:dnsZoneName`]: "example.test",
      "grid-oib:cloudflareApiToken": "cf-token", // pragma: allowlist secret
    });
    expect(error?.message).toMatch(/qdrant\.elsewhere\.test is not inside it/);
  });

  it("refuses the template placeholder host", () => {
    const error = loadWith({ "grid-oib:qdrantDashboardDomain": "qdrant.example.com" });
    expect(error?.message).toMatch(/grid-oib:qdrantDashboardDomain is still the template placeholder/);
  });

  it("refuses an explicit true without the Connect application, naming what is missing", () => {
    const error = loadWith({
      "grid-oib:qdrantDashboardEnabled": "true",
      "grid-oib:otelOidcIssuer": "https://grid.authkit.app",
    });
    expect(error?.message).toMatch(
      /qdrantDashboardEnabled needs the platform WorkOS Connect application .*missing grid-oib:otelOidcClientId, grid-oib:otelOidcClientSecret/,
    );
    expect(loadWith({ ...connectApp, "grid-oib:qdrantDashboardEnabled": "true" })).toBeNull();
  });
});

describe("SeaweedFS topology", () => {

  it("refuses an even master count", () => {
    const error = loadWith({ "grid-oib:seaweedfsMasterReplicas": "2" });
    expect(error?.message).toMatch(/odd number/);
  });

  it("refuses more filer replicas than the embedded store can serve", () => {
    const error = loadWith({
      "grid-oib:seaweedfsFilerStore": "leveldb",
      "grid-oib:seaweedfsFilerReplicas": "2",
    });
    expect(error?.message).toMatch(/private namespace/);
  });

  it("refuses a replication factor it cannot place", () => {
    const error = loadWith({
      "grid-oib:seaweedfsDefaultReplication": "010",
      "grid-oib:seaweedfsVolumeReplicas": "1",
    });
    expect(error?.message).toMatch(/asks for 2 copies but/);
  });

  it("refuses a free-space brake smaller than one volume", () => {
    const error = loadWith({
      "grid-oib:seaweedfsVolumeSizeLimitMB": "1024",
      "grid-oib:seaweedfsVolumeMinFreeSpace": "512MiB",
    });
    expect(error?.message).toMatch(/smaller than one volume/);
  });

  it("requires the filer store credential on the split topology", () => {
    const error = loadWith({ "grid-oib:seaweedfsTopology": "split" }, [
      "grid-oib:seaweedfsFilerDbPassword",
    ]);
    expect(error?.message).toMatch(/seaweedfsFilerDbPassword is required/);
  });

  it("does not require it on the single-node topology, which has no filer store", () => {
    expect(
      loadWith({ "grid-oib:seaweedfsTopology": "single" }, [
        "grid-oib:seaweedfsFilerDbPassword",
      ]),
    ).toBeNull();
  });

  it("requires the bucket-lifecycle credential only when tenant buckets are on", () => {
    expect(
      loadWith({ "grid-oib:seaweedfsPerOrgBuckets": "true" }, [
        "grid-oib:seaweedfsTenantAdminSecretKey",
      ])?.message,
    ).toMatch(/seaweedfsTenantAdminSecretKey is required/);
    expect(
      loadWith({ "grid-oib:seaweedfsPerOrgBuckets": "false" }, [
        "grid-oib:seaweedfsTenantAdminSecretKey",
      ]),
    ).toBeNull();
  });
});

describe("documents backup credentials", () => {
  const enable = {
    "grid-oib:seaweedfsBackupEnabled": "true",
    "grid-oib:seaweedfsBackupEndpoint": "https://offsite.example.test",
    "grid-oib:seaweedfsBackupAccessKey": "offsite-key", // pragma: allowlist secret
    "grid-oib:seaweedfsBackupSecretKey": "offsite-secret", // pragma: allowlist secret
  };

  it.each([
    ["the secret key", "grid-oib:seaweedfsBackupSecretKey"],
    ["the access key", "grid-oib:seaweedfsBackupAccessKey"],
  ])("refuses a mirror missing %s", (_label, omitted) => {
    const error = loadWith(enable, [omitted]);
    expect(error?.message).toContain(omitted);
    expect(error?.message).toMatch(/required when seaweedfsBackupEnabled is true/);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("refuses a key set to %s, which cannot sign anything", (_label, value) => {
    const error = loadWith({ ...enable, "grid-oib:seaweedfsBackupSecretKey": value });
    expect(error?.message).toContain("grid-oib:seaweedfsBackupSecretKey");
    expect(error?.message).toMatch(/required when seaweedfsBackupEnabled is true/);
  })

  it("names every missing key at once, so one plan reports the whole gap", () => {
    const error = loadWith(enable, [
      "grid-oib:seaweedfsBackupAccessKey",
      "grid-oib:seaweedfsBackupSecretKey",
    ]);
    expect(error?.message).toContain("grid-oib:seaweedfsBackupAccessKey");
    expect(error?.message).toContain("grid-oib:seaweedfsBackupSecretKey");
  });

  it("accepts a fully configured mirror", () => {
    expect(loadWith(enable)).toBeNull();
  });

  it("asks for neither key while the mirror is off", () => {
    expect(
      loadWith({}, [
        "grid-oib:seaweedfsBackupAccessKey",
        "grid-oib:seaweedfsBackupSecretKey",
      ]),
    ).toBeNull();
  });
});

describe("chat tier scale-out (ADR-0080)", () => {
  it("keeps affinity on by default, so the tier is the static hash it was", () => {
    expect(loadWith({})).toBeNull();
    pulumi.runtime.setAllConfig({ ...baseStackConfig() });
    expect(loadConfig().backend.chatAffinity).toBe(true);
  });

  it("keeps the short drain while the count is static, and the longest turn once KEDA owns it", () => {
    pulumi.runtime.setAllConfig({ ...baseStackConfig() });
    expect(loadConfig().backend.drainSeconds).toBe(20);
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:chatAffinity": "false" });
    expect(loadConfig().backend.drainSeconds).toBe(2730);
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), "grid-oib:backendDrainSeconds": "300" });
    expect(loadConfig().backend.drainSeconds).toBe(300);
  });

  it("refuses a ceiling below the floor", () => {
    const error = loadWith({ "grid-oib:backendReplicas": "3", "grid-oib:backendMaxReplicas": "2" });
    expect(error?.message).toMatch(/backendMaxReplicas/);
  });

  it("refuses affinity off without the conversation bus", () => {
    const error = loadWith({ "grid-oib:chatAffinity": "false", "grid-oib:conversationBus": "false" });
    expect(error?.message).toMatch(/needs grid-oib:conversationBus=true/);
  });
});

describe("malwareScan", () => {
  function cfgWith(values: Record<string, string>) {
    pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...values });
    return loadConfig();
  }

  it("is off by default, on a digest-pinned image", () => {
    const { malwareScan } = cfgWith({});
    expect(malwareScan.enabled).toBe(false);
    expect(malwareScan.image).toMatch(/^clamav\/clamav:1\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  });

  it("switches on per stack", () => {
    expect(cfgWith({ [`${LEGACY_PROJECT}:malwareScanEnabled`]: "true" }).malwareScan.enabled).toBe(true);
  });

  it.each(["clamav/clamav:1.5.4", "clamav/clamav:latest", "clamav/clamav@sha256:abc"])(
    "refuses an image without a full digest: %s",
    (image) => {
      expect(loadWith({ [`${LEGACY_PROJECT}:malwareScanImage`]: image })?.message).toMatch(/malwareScanImage .* pin it by digest/);
    },
  );

  it.each(["fake://", "fake:", "tcp://clamd.elsewhere:3310"])(
    "refuses a scanner URL on any stack, the development fake above all: %s",
    (url) => {
      expect(loadWith({ [`${LEGACY_PROJECT}:malwareScanUrl`]: url })?.message).toMatch(/malwareScanUrl .* is refused/);
    },
  );
});

describe("project mail (ADR-0138)", () => {
  const mail = {
    ...mailStackConfig(),
    [`${LEGACY_PROJECT}:inboundMailDomain`]: "inbox.post.example.test",
    [`${LEGACY_PROJECT}:inboundMailZoneId`]: MAIL_ZONE_ID,
  };
  const keys = (map: Record<string, unknown>) => ({ ...mail, [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: JSON.stringify(map) });

  it("is off, and asks for nothing, while the domain is unset", () => {
    expect(loadWith({})).toBeNull();
    const values = loadValues({}).inboundMail;
    expect(values).toMatchObject({ configured: false, enabled: false, signingKeyId: "" });
  });

  it("loads with the domain, the zone, the scanner, a key and the token", () => {
    expect(loadWith(mail)).toBeNull();
    expect(loadValues(mail).inboundMail).toMatchObject({
      configured: true,
      enabled: true,
      paused: false,
      domain: "inbox.post.example.test",
      localPart: "project",
      signingKeyId: SIGNING_KEY_ID,
    });
  });

  it("refuses the domain while the malware scanner is off", () => {
    const error = loadWith({ ...mail, [`${LEGACY_PROJECT}:malwareScanEnabled`]: "false" });
    expect(error?.message).toMatch(/inboundMailDomain needs malwareScanEnabled=true/);
  });

  it.each([`${LEGACY_PROJECT}:inboundMailSigningKeys`, `${LEGACY_PROJECT}:cloudflareApiToken`])("refuses the domain without %s", (key) => {
    expect(loadWith(mail, [key])?.message).toContain(key);
  });

  it.each([
    ["not JSON", "mi-2026-10=abc", /not JSON/],
    ["an array", "[]", /not an object/],
    ["no keys", "{}", /it has 0/],
    ["three keys", JSON.stringify({ a: SIGNING_SECRET, b: SIGNING_SECRET, c: SIGNING_SECRET }), /it has 3/],
    ["a keyid with a space", JSON.stringify({ "mi 2026": SIGNING_SECRET }), /keyid "mi 2026"/],
    ["a short secret", JSON.stringify({ k: Buffer.alloc(16, 1).toString("base64") }), /secret of "k"/],
    ["a hex secret", JSON.stringify({ k: "ab".repeat(32) + "!" }), /secret of "k"/],
    [
      "the development secret",
      JSON.stringify({ k: Buffer.from("internal-dev-signing-secret-0032").toString("base64") }),
      /well-known development secret/,
    ],
  ])("refuses a key map that is %s, as the BFF would", (_label, raw, message) => {
    const error = loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailSigningKeys`]: raw });
    expect(error?.message).toMatch(message);
    expect(error?.message).not.toContain(SIGNING_SECRET);
  });

  it("requires the Worker's keyid while two keys are held", () => {
    const two = keys({ old: SIGNING_SECRET, new: Buffer.alloc(32, 3).toString("base64") });
    expect(loadWith(two)?.message).toMatch(/inboundMailSigningKeyId must name the key/);
    expect(loadWith({ ...two, [`${LEGACY_PROJECT}:inboundMailSigningKeyId`]: "new" })).toBeNull();
    expect(loadWith({ ...two, [`${LEGACY_PROJECT}:inboundMailSigningKeyId`]: "gone" })?.message).toMatch(/got "gone"/);
  });

  it("switches off without keys, but keeps the zone checks", () => {
    const off = { ...mail, [`${LEGACY_PROJECT}:inboundMailEnabled`]: "false" };
    delete (off as Record<string, string>)[`${LEGACY_PROJECT}:inboundMailSigningKeys`];
    expect(loadWith(off)).toBeNull();
    expect(loadValues(off).inboundMail).toMatchObject({ configured: true, enabled: false });
    expect(loadWith({ ...off, [`${LEGACY_PROJECT}:inboundMailZoneId`]: "" }, [`${LEGACY_PROJECT}:inboundMailZoneId`])?.message).toMatch(
      /inboundMailZoneId is required/,
    );
  });

  it("reads the pause", () => {
    expect(loadValues({ ...mail, [`${LEGACY_PROJECT}:inboundMailPaused`]: "true" }).inboundMail.paused).toBe(true);
  });

  it("reads the direct-filing switch, on by default, and hands it to the app", async () => {
    expect(loadValues(mail).inboundMail.directFiling).toBe(true);
    const off = loadValues({ ...mail, [`${LEGACY_PROJECT}:inboundMailDirectFiling`]: "false" }).inboundMail;
    expect(off.directFiling).toBe(false);
    const { inboundMailAppEnv } = await import("./config/inbound-mail");
    expect(inboundMailAppEnv(off).find((e) => e.name === "INBOUND_MAIL_DIRECT_FILING")?.value).toBe("false");
    expect(inboundMailAppEnv({ ...off, enabled: false })).toEqual([]);
  });

  it("refuses the domain without the zone to enable routing on", () => {
    expect(loadWith(mail, [`${LEGACY_PROJECT}:inboundMailZoneId`])?.message).toMatch(/inboundMailZoneId is required/);
  });

  it("reads the local part, lowercased", () => {
    expect(loadValues({ ...mail, [`${LEGACY_PROJECT}:inboundMailLocalPart`]: "Projekt" }).inboundMail.localPart).toBe("projekt");
  });

  it.each(["p+x", "p.x", "-p", "p-", "ä", "a".repeat(33)])("refuses %s as a local part, which no address could match", (localPart) => {
    expect(loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailLocalPart`]: localPart })?.message).toMatch(
      /inboundMailLocalPart must be/,
    );
  });

  it.each(["https://post.example.test", "inbox@post.example.test", "post"])("refuses %s as a domain", (domain) => {
    expect(loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailDomain`]: domain })?.message).toMatch(
      /must be a bare domain name/,
    );
  });

  it("refuses the DNS zone's id for a domain outside that zone", () => {
    const error = loadWith({
      ...mail,
      [`${LEGACY_PROJECT}:inboundMailDomain`]: "inbox.example.org",
      [`${LEGACY_PROJECT}:inboundMailZoneId`]: "d".repeat(32),
      [`${LEGACY_PROJECT}:dnsZoneId`]: "d".repeat(32),
      [`${LEGACY_PROJECT}:dnsZoneName`]: "example.test",
    });
    expect(error?.message).toMatch(/is not in its zone \("example\.test"\)/);
  });

  it.each([
    ["a subdomain of it (the recommended setup)", `inbox.${APP_ZONE}`],
    ["its apex", APP_ZONE],
  ])("takes the app zone when the domain is %s and no zone is given", (_label, domain) => {
    const values = { ...appZoneStackConfig(), ...mailStackConfig(), [`${LEGACY_PROJECT}:inboundMailDomain`]: domain };
    expect(loadWith(values)).toBeNull();
    expect(loadValues(values).inboundMail.zoneId).toBe(APP_ZONE_ID);
  });

  it.each([
    [`${LEGACY_PROJECT}:dnsZoneBaseline`, "false"],
    [`${LEGACY_PROJECT}:dnsEnabled`, "false"],
  ])("refuses project mail on the app zone unless this stack owns it (%s=%s)", (key, value) => {
    const error = loadWith({
      ...appZoneStackConfig(),
      ...mail,
      [`${LEGACY_PROJECT}:inboundMailDomain`]: `inbox.${APP_ZONE}`,
      [`${LEGACY_PROJECT}:inboundMailZoneId`]: APP_ZONE_ID,
      [`${LEGACY_PROJECT}:baseDomain`]: `www2.${APP_ZONE}`,
      [key]: value,
    });
    expect(error?.message).toMatch(/inboundMailDomain on the app zone needs dnsEnabled/);
  });

  it.each(["<the zone id of archos.tech>", "zone-mail-1", "0123456789ABCDEF0123456789ABCDEF", "a".repeat(31)])(
    "refuses %s as inboundMailZoneId, so the stack file's placeholder cannot deploy",
    (zoneId) => {
      expect(loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailZoneId`]: zoneId })?.message).toMatch(
        /inboundMailZoneId must be a Cloudflare zone id, 32 hex digits/,
      );
    },
  );

  it("requires the operator's mailbox for the RFC 2142 forwards, switched off too", () => {
    expect(loadWith(mail, [`${LEGACY_PROJECT}:inboundMailOperatorAddress`])?.message).toMatch(
      /inboundMailOperatorAddress is required when inboundMailDomain is set.*postmaster@inbox\.post\.example\.test/,
    );
    const off = { ...mail, [`${LEGACY_PROJECT}:inboundMailEnabled`]: "false" };
    expect(loadWith(off, [`${LEGACY_PROJECT}:inboundMailOperatorAddress`])?.message).toMatch(/is required/);
    expect(loadValues(mail).inboundMail.operatorAddress).toBe(OPERATOR_ADDRESS);
  });

  it.each(["mail-ops", "Ops <ops@company.example>", "a@b@company.example", "ops@company.example, abuse@company.example"])(
    "refuses %s as the operator's mailbox",
    (address) => {
      expect(loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailOperatorAddress`]: address })?.message).toMatch(
        /inboundMailOperatorAddress must be one mailbox address/,
      );
    },
  );

  it("refuses an operator mailbox on the receiving domain, where its forwards would bounce", () => {
    const error = loadWith({ ...mail, [`${LEGACY_PROJECT}:inboundMailOperatorAddress`]: "ops@inbox.post.example.test" });
    expect(error?.message).toMatch(/is on the receiving domain/);
  });

  const dmarc = (value: string) => ({ ...mail, [`${LEGACY_PROJECT}:inboundMailDmarc`]: value });
  const RECOMMENDED = `v=DMARC1; p=none; sp=none; adkim=r; aspf=r; rua=mailto:${OPERATOR_ADDRESS}`;

  it("reads inboundMailDmarc, unset by default", () => {
    expect(loadValues(mail).inboundMail.dmarc).toBeUndefined();
    expect(loadWith(dmarc(RECOMMENDED))).toBeNull();
    expect(loadValues(dmarc(` ${RECOMMENDED} `)).inboundMail.dmarc).toBe(RECOMMENDED);
  });

  it.each([
    ["no version tag", "p=none; sp=none", /must start with "v=DMARC1;"/],
    ["an SPF record", "v=spf1 include:_spf.google.com ~all", /must start with "v=DMARC1;"/],
    ["no policy", "v=DMARC1; rua=mailto:ops@company.example", /no "p=" policy/],
    ["a typo in a tag", "v=DMARC1; p=none; sp-none", /"sp-none" is not a DMARC tag/],
    ["a policy that does not exist", "v=DMARC1; p=monitor", /"p=monitor" is not a valid value/],
  ])("refuses an inboundMailDmarc with %s", (_label, value, message) => {
    const error = loadWith(dmarc(value));
    expect(error?.message).toMatch(/inboundMailDmarc is not a DMARC record/);
    expect(error?.message).toMatch(message);
  });

  it("refuses inboundMailDmarc without the domain, whose zone it is published on", () => {
    expect(loadWith({ [`${LEGACY_PROJECT}:inboundMailDmarc`]: RECOMMENDED })?.message).toMatch(
      /inboundMailDmarc is set without inboundMailDomain/,
    );
  });

  it("refuses inboundMailDmarc beside dnsDmarc on the app zone, which would be two DMARC records", () => {
    const both = {
      ...appZoneStackConfig(),
      ...mailStackConfig(),
      [`${LEGACY_PROJECT}:inboundMailDomain`]: `inbox.${APP_ZONE}`,
      [`${LEGACY_PROJECT}:inboundMailDmarc`]: RECOMMENDED,
      [`${LEGACY_PROJECT}:dnsDmarc`]: "v=DMARC1; p=quarantine",
    };
    expect(loadWith(both)?.message).toMatch(new RegExp(`inboundMailDmarc and dnsDmarc both publish _dmarc\\.${APP_ZONE}`));
    expect(loadWith(both, [`${LEGACY_PROJECT}:dnsDmarc`])).toBeNull();
    expect(loadWith(both, [`${LEGACY_PROJECT}:inboundMailDmarc`])).toBeNull();
  });

  it("allows inboundMailDmarc on a mail zone of its own beside a dnsDmarc on the app zone", () => {
    const values = {
      ...appZoneStackConfig(),
      ...mail,
      [`${LEGACY_PROJECT}:dnsDmarc`]: "v=DMARC1; p=quarantine",
      [`${LEGACY_PROJECT}:inboundMailDmarc`]: RECOMMENDED,
    };
    expect(loadWith(values)).toBeNull();
  });
});
