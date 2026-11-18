import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { HATCHET, HATCHET_API_URL, HATCHET_GRPC_ADDRESS, HATCHET_TOKEN_SECRET } from "../platform/hatchet";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export function hatchetNamespace(): string {
  return pulumi.getStack().toLowerCase();
}

export function hatchetEnv(): EnvVar[] {
  return [
    {
      name: "HATCHET_CLIENT_TOKEN",
      valueFrom: { secretKeyRef: { name: HATCHET_TOKEN_SECRET, key: HATCHET.tokenKey, optional: true } },
    },
    { name: "HATCHET_CLIENT_HOST_PORT", value: HATCHET_GRPC_ADDRESS },
    { name: "HATCHET_CLIENT_SERVER_URL", value: HATCHET_API_URL },
    { name: "HATCHET_CLIENT_API_URL", value: HATCHET_API_URL },
    { name: "HATCHET_CLIENT_TLS_STRATEGY", value: "none" },
    { name: "HATCHET_CLIENT_NAMESPACE", value: hatchetNamespace() },
  ];
}
