/**
 * How a tier reaches Hatchet (ADR-0150): the SDK's own environment, the same
 * names for the Python SDK and the TypeScript one, except the REST API's URL,
 * which each SDK reads under its own name. Every tier built from
 * `backendEnv` (chat, api, the research and ingest workers, the housekeeping
 * Jobs) and from `frontendEnv` (the frontend, the bff-jobs pool) gets it: the
 * request tiers start runs, the worker tiers run them.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { HATCHET, HATCHET_API_URL, HATCHET_GRPC_ADDRESS, HATCHET_TOKEN_SECRET } from "../platform/hatchet";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/**
 * Hatchet's namespace for this stack's workflows (`HATCHET_CLIENT_NAMESPACE`):
 * the stack name. The SDKs lower-case it and append `_` to every workflow
 * name, which is what the KEDA triggers match (`hatchetBacklogQuery`).
 */
export function hatchetNamespace(): string {
  return pulumi.getStack().toLowerCase();
}

export function hatchetEnv(): EnvVar[] {
  return [
    // Copied from the chart's worker-token Job by `hatchet-token-sync`. Optional,
    // so a one-shot Job that never starts a run is not held at
    // CreateContainerConfigError; the tiers that do are ordered after the copy.
    {
      name: "HATCHET_CLIENT_TOKEN",
      valueFrom: { secretKeyRef: { name: HATCHET_TOKEN_SECRET, key: HATCHET.tokenKey, optional: true } },
    },
    { name: "HATCHET_CLIENT_HOST_PORT", value: HATCHET_GRPC_ADDRESS },
    // The REST API (scheduled runs, crons, cancels, pauses). Without it both SDKs
    // take the token's `server_url`, the dashboard's localhost, and every such
    // call fails. Python reads the first name, TypeScript the second.
    { name: "HATCHET_CLIENT_SERVER_URL", value: HATCHET_API_URL },
    { name: "HATCHET_CLIENT_API_URL", value: HATCHET_API_URL },
    // Plaintext inside the cluster: the engine serves gRPC insecure (`grpcInsecure`).
    { name: "HATCHET_CLIENT_TLS_STRATEGY", value: "none" },
    { name: "HATCHET_CLIENT_NAMESPACE", value: hatchetNamespace() },
  ];
}
