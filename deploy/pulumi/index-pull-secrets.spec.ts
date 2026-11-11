import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "./src/test-support/stack-config";
import { readFileSync } from "node:fs";

/** The program's project (Pulumi.yaml), the prefix of every stack key. */
const PROJECT = /^name:\s*(\S+)/m.exec(readFileSync(new URL("./Pulumi.yaml", import.meta.url), "utf8"))![1];
const key = (name: string) => `${PROJECT}:${name}`;

/**
 * Every pod that runs one of our private images carries a registry pull Secret.
 * The whole program is built with a private registry configured, so a workload
 * installed outside the shared `AppWiring` that forgets the Secret fails here,
 * not on a cluster as ImagePullBackOff (the public-source fetcher after #1592).
 */

const REGISTRY = "registry.example.test/owner";
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

const WORKLOADS = [
  "kubernetes:apps/v1:Deployment",
  "kubernetes:apps/v1:StatefulSet",
  "kubernetes:apps/v1:DaemonSet",
  "kubernetes:batch/v1:Job",
  "kubernetes:batch/v1:CronJob",
];

type PodSpec = { containers?: Array<{ image?: string }>; initContainers?: Array<{ image?: string }>; imagePullSecrets?: unknown[] };

function podSpecOf(type: string, inputs: Record<string, any>): PodSpec | undefined {
  if (type.endsWith(":CronJob")) return inputs.spec?.jobTemplate?.spec?.template?.spec;
  return inputs.spec?.template?.spec;
}

describe("private images and the registry pull Secret", () => {
  beforeAll(async () => {
    RESOURCES.length = 0;
    pulumi.runtime.setAllConfig({
      ...baseStackConfig(),
      [key("baseDomain")]: "dev.example.test",
      [key("imageRegistry")]: REGISTRY,
      [key("imageTag")]: "sha-0123456789abcdef0123456789abcdef01234567",
      [key("registryUsername")]: "deploy-bot",
      [key("registryPassword")]: "placeholder-secret-value", // pragma: allowlist secret
    });
    vi.resetModules();
    const stack = (await import("./index")) as Record<string, unknown>;
    await Promise.all(
      Object.values(stack)
        .filter((v): v is pulumi.Output<unknown> => pulumi.Output.isInstance(v))
        .map((output) => new Promise((resolve) => output.apply(resolve))),
    );
  }, 120_000);

  it("gives every pod that runs a private image a pull Secret", () => {
    const privatePods = RESOURCES.filter((r) => WORKLOADS.includes(r.type))
      .map((r) => ({ id: `${r.type.split(":").pop()}/${r.name}`, pod: podSpecOf(r.type, r.inputs) }))
      .filter(({ pod }) => [...(pod?.containers ?? []), ...(pod?.initContainers ?? [])].some((c) => String(c.image ?? "").startsWith(REGISTRY)));
    expect(privatePods.map(({ id }) => id)).toContain("Deployment/public-source-fetcher");
    const missing = privatePods.filter(({ pod }) => !(pod?.imagePullSecrets?.length ?? 0)).map(({ id }) => id);
    expect(missing).toEqual([]);
  });
});
