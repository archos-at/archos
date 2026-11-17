import * as pulumi from "@pulumi/pulumi";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Growing a StatefulSet's volume on deploy, never shrinking it. The live PVC's
 * size is whatever the mock answers for the read, as the cluster would.
 */

let liveSize: string | undefined = "10Gi";
const PATCHES: Array<{ name: string; inputs: Record<string, unknown> }> = [];
const READS: string[] = [];

pulumi.runtime.setMocks(
  {
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      if (args.id !== undefined && args.type === "kubernetes:core/v1:PersistentVolumeClaim") {
        READS.push(args.id);
        return {
          id: args.id,
          state: { spec: { resources: { requests: liveSize === undefined ? {} : { storage: liveSize } } } },
        };
      }
      if (args.type === "kubernetes:core/v1:PersistentVolumeClaimPatch") PATCHES.push({ name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: () => ({}),
  },
  "project",
  "test",
  false,
);

function value<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => output.apply(resolve));
}

let seq = 0;
async function grow(configured: string) {
  const k8s = await import("@pulumi/kubernetes");
  const { growPvcToConfigured } = await import("./pvc-grow");
  seq += 1;
  const provider = new k8s.Provider(`p${seq}`, {});
  const patch = growPvcToConfigured(`data-size-${seq}`, {
    provider,
    namespace: "grid",
    pvcName: "data-seaweedfs-0",
    configured,
    dependsOn: [],
  });
  await value(patch.id);
  return PATCHES.at(-1)!.inputs as {
    metadata: { name: string; namespace: string; annotations: Record<string, string> };
    spec: { resources: { requests: { storage: string } } };
  };
}

beforeEach(() => {
  liveSize = "10Gi";
});

describe("growing a StatefulSet's volume on deploy", () => {
  it("raises the live volume to a larger configured size", async () => {
    // Dev, 2026-11: a 10 GiB volume, full, the config raised to 30Gi.
    const patch = await grow("30Gi");
    expect(patch.spec.resources.requests.storage).toBe("30Gi");
    expect(patch.metadata).toMatchObject({ name: "data-seaweedfs-0", namespace: "grid" });
    expect(READS.at(-1)).toBe("grid/data-seaweedfs-0");
  });

  it("never asks for less than the live volume holds", async () => {
    // Prod: the config says 20Gi for a volume grown by hand to 100Gi. A plain
    // patch would ask Kubernetes to shrink it, which it refuses, failing every deploy.
    liveSize = "100Gi";
    const patch = await grow("20Gi");
    expect(patch.spec.resources.requests.storage).toBe("100Gi");
  });

  it("compares sizes, not spellings", async () => {
    liveSize = "107374182400"; // 100Gi in bytes
    expect((await grow("100Gi")).spec.resources.requests.storage).toBe("107374182400");
    liveSize = "100G"; // 1e11 bytes, less than 100Gi
    expect((await grow("100Gi")).spec.resources.requests.storage).toBe("100Gi");
    liveSize = "2e11"; // exponent form, larger than 100Gi: no growth, no failure
    expect((await grow("100Gi")).spec.resources.requests.storage).toBe("2e11");
  });

  it("takes over a field a hand-run kubectl patch owns", async () => {
    const patch = await grow("30Gi");
    expect(patch.metadata.annotations["pulumi.com/patchForce"]).toBe("true");
  });
});

describe("quantityBytes", () => {
  it("reads binary and decimal suffixes and plain bytes", async () => {
    const { quantityBytes } = await import("./pvc-grow");
    expect(quantityBytes("30Gi")).toBe(30 * 2 ** 30);
    expect(quantityBytes("1.5Ti")).toBe(1.5 * 2 ** 40);
    expect(quantityBytes("100G")).toBe(1e11);
    expect(quantityBytes("512")).toBe(512);
    expect(quantityBytes("1e11")).toBe(1e11);
    expect(quantityBytes("5E9")).toBe(5e9);
    expect(quantityBytes("5E")).toBe(5e18); // E alone is exa, not an exponent
  });

  it("refuses what is not a quantity, so a typo fails the plan instead of shrinking nothing silently", async () => {
    const { quantityBytes } = await import("./pvc-grow");
    expect(() => quantityBytes("30 GB")).toThrow(/Not a storage quantity/);
    expect(() => quantityBytes("")).toThrow(/Not a storage quantity/);
    expect(() => quantityBytes("1e")).toThrow(/Not a storage quantity/);
    expect(() => quantityBytes("1eGi")).toThrow(/Not a storage quantity/);
  });
});
