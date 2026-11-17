import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { commonLabels } from "../platform/namespaces";
import { AppWiring } from "./config";
import { HATCHET_QUEUE_AUTH, installTriggerAuth } from "./keda-scaling";

export const HATCHET_SCALER_SECRET = "background-work-keda-scaler"; // pragma: allowlist secret (a Secret's name)
export const HATCHET_SCALER_DSN_KEY = "KEDA_BACKGROUND_WORK_DB_URL";

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
