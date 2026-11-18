import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function growPvcToConfigured(
  name: string,
  args: {
    provider: k8s.Provider;
    namespace: pulumi.Input<string>;
    pvcName: string;
    configured: string;
    dependsOn: pulumi.Resource[];
  },
): k8s.core.v1.PersistentVolumeClaimPatch {
  const live = k8s.core.v1.PersistentVolumeClaim.get(
    `${name}-live`,
    pulumi.interpolate`${args.namespace}/${args.pvcName}`,
    { provider: args.provider, dependsOn: args.dependsOn },
  );
  const size = live.spec.apply((spec) =>
    largerQuantity(spec?.resources?.requests?.storage ?? args.configured, args.configured),
  );
  return new k8s.core.v1.PersistentVolumeClaimPatch(
    name,
    {
      metadata: {
        name: args.pvcName,
        namespace: args.namespace,
        annotations: { "pulumi.com/patchForce": "true" },
      },
      spec: { resources: { requests: { storage: size } } },
    },
    { provider: args.provider, dependsOn: [live] },
  );
}

const BINARY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const DECIMAL: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

export function quantityBytes(quantity: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)|[eE]([+-]?[0-9]+))?$/.exec(quantity.trim());
  if (!match) throw new Error(`Not a storage quantity: "${quantity}" (expected e.g. 30Gi)`);
  if (match[3] !== undefined) return Number(match[1]) * 10 ** Number(match[3]);
  const unit = match[2] ?? "";
  const factor = BINARY[unit] ?? DECIMAL[unit];
  return Number(match[1]) * factor;
}

export function largerQuantity(live: string, configured: string): string {
  return quantityBytes(configured) > quantityBytes(live) ? configured : live;
}
