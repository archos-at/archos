import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * Grow a StatefulSet's PVC to its configured size on deploy, and never shrink it.
 *
 * A StatefulSet's `volumeClaimTemplates` is immutable and every data tier here
 * `ignoreChanges` it, so the template's size is the initial size only: raising
 * `seaweedfsStorageSize` deployed and changed nothing, and growing the volume
 * was a `kubectl patch pvc` somebody had to remember. On dev in 2026-11 nobody
 * did: the 10 GiB SeaweedFS volume filled, its volumes went read-only for low
 * disk space, and project mail and uploads failed for two days
 * (docs/contributing/gotchas.md).
 *
 * The live PVC is read first and the patch asks for the larger of its current
 * request and the configured size, because the configured size can be smaller
 * than the volume: prod's says 20Gi for a volume grown by hand to about 100Gi.
 * Asking Kubernetes for less is refused ("field can not be less than previous
 * value"), so a plain patch would have failed every deploy. A smaller config
 * value is therefore a no-op, never a shrink, and growing is the config change
 * alone.
 *
 * Only for a PVC that exists: the read fails on a cluster whose StatefulSet has
 * not created it yet, so a stack turns this on (`<tier>GrowVolume`) once its
 * volume exists. A fresh cluster needs nothing: the template creates the volume
 * at the configured size.
 */
export function growPvcToConfigured(
  name: string,
  args: {
    provider: k8s.Provider;
    namespace: pulumi.Input<string>;
    /** The PVC's name: `<template>-<statefulset>-<ordinal>`. */
    pvcName: string;
    /** The configured size, a Kubernetes quantity such as `30Gi`. */
    configured: string;
    dependsOn: pulumi.Resource[];
  },
): k8s.core.v1.PersistentVolumeClaimPatch {
  const live = k8s.core.v1.PersistentVolumeClaim.get(
    `${name}-live`,
    pulumi.interpolate`${args.namespace}/${args.pvcName}`,
    { provider: args.provider, dependsOn: args.dependsOn },
  );
  // One apply on `spec`, not a lifted `spec.resources.requests` path: the lifted
  // path is undefined when the read returns no such shape, and throws.
  const size = live.spec.apply((spec) =>
    largerQuantity(spec?.resources?.requests?.storage ?? args.configured, args.configured),
  );
  return new k8s.core.v1.PersistentVolumeClaimPatch(
    name,
    {
      metadata: {
        name: args.pvcName,
        namespace: args.namespace,
        // A volume grown by hand with `kubectl patch` has that manager as the
        // owner of the field; the deploy takes it over rather than fail on the conflict.
        annotations: { "pulumi.com/patchForce": "true" },
      },
      spec: { resources: { requests: { storage: size } } },
    },
    // Deleting this resource only hands the field back: a PVC never shrinks.
    { provider: args.provider, dependsOn: [live] },
  );
}

const BINARY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const DECIMAL: Record<string, number> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

/** A Kubernetes storage quantity (`30Gi`, `100G`, `1e11`, `107374182400`) in bytes. Throws on anything else. */
export function quantityBytes(quantity: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)|[eE]([+-]?[0-9]+))?$/.exec(quantity.trim());
  if (!match) throw new Error(`Not a storage quantity: "${quantity}" (expected e.g. 30Gi)`);
  // Kubernetes also spells a decimal exponent: `1e11`, `5E9`.
  if (match[3] !== undefined) return Number(match[1]) * 10 ** Number(match[3]);
  const unit = match[2] ?? "";
  const factor = BINARY[unit] ?? DECIMAL[unit];
  return Number(match[1]) * factor;
}

/** The larger of two quantities, spelled as it was given; on a tie, the live one, so nothing changes. */
export function largerQuantity(live: string, configured: string): string {
  return quantityBytes(configured) > quantityBytes(live) ? configured : live;
}
