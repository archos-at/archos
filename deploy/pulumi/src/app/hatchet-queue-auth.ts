import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels } from "../platform/namespaces";
import { AppWiring } from "./config";
import { HATCHET_QUEUE_AUTH, installTriggerAuth } from "./keda-scaling";

/** The Secret holding the scaler's DSN on `background-work-pg`; no pod reads it. */
export const HATCHET_SCALER_SECRET = "background-work-keda-scaler"; // pragma: allowlist secret (a Secret's name)
export const HATCHET_SCALER_DSN_KEY = "KEDA_BACKGROUND_WORK_DB_URL";

/**
 * How KEDA reads Hatchet's backlog (ADR-0150): the read-only `keda_scaler`
 * login on `background-work-pg`, whose grants are SELECT on the columns the
 * count reads (`background-work-pg.ts`), never Hatchet's owner. A Secret of its
 * own in the app namespace, because a TriggerAuthentication reads Secrets of
 * its ScaledObject's namespace, and one no pod's checksum covers, so a
 * rotation rolls nothing. One for all three tiers: one database.
 */
export function installHatchetQueueAuth(
  w: AppWiring,
  scalerDsn: pulumi.Output<string>,
  dependsOn: pulumi.Resource[],
): k8s.apiextensions.CustomResource {
  const labels = commonLabels("hatchet-queue");
  const secret = new k8s.core.v1.Secret(
    HATCHET_SCALER_SECRET,
    { metadata: { name: HATCHET_SCALER_SECRET, namespace: w.namespace, labels }, stringData: { [HATCHET_SCALER_DSN_KEY]: scalerDsn } },
    { provider: w.provider },
  );
  return installTriggerAuth(w, {
    name: HATCHET_QUEUE_AUTH,
    parameter: "connection",
    secretName: HATCHET_SCALER_SECRET,
    key: HATCHET_SCALER_DSN_KEY,
    labels,
    dependsOn: [secret, ...dependsOn],
  });
}
